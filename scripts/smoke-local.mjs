/*
 * Runs scripts/smoke-worker.mjs against a throwaway Worker state.
 *
 * The smoke test writes real rows to D1, and a connected app pulls them onto
 * the shelf. Booting its own `--persist-to` directory keeps that noise out of
 * `.wrangler/state`, so `npm run smoke` never edits your local library.
 *
 *   npm run smoke            # isolated worker, port 8799
 *   npm run smoke -- --keep  # leave its D1 state behind for inspection
 *
 * Wrangler is started as a Node module rather than through npx: spawning a
 * .cmd shim with shell: true breaks on Windows paths containing spaces.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.SMOKE_PORT || 8799);
const STATE = path.resolve('.wrangler/smoke-state');
const TOKEN = 'smoke-local-token';
const KEEP = process.argv.includes('--keep');
const WRANGLER = path.resolve('node_modules/wrangler/bin/wrangler.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(args, options = {}) {
	return spawnSync(process.execPath, [WRANGLER, ...args], { stdio: 'inherit', ...options });
}

async function stop(child) {
	if (!child || child.exitCode !== null) return;
	const exited = new Promise((resolve) => child.once('exit', resolve));
	if (process.platform === 'win32') {
		spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
	} else {
		child.kill('SIGTERM');
	}
	await Promise.race([exited, sleep(5000)]);
}

async function waitForWorker(url, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, {
				headers: { Authorization: `Bearer ${TOKEN}` },
				signal: AbortSignal.timeout(2000)
			});
			if (response.ok) return;
		} catch {
			/* not up yet */
		}
		await sleep(500);
	}
	throw new Error(`Worker did not answer on ${url} within ${timeoutMs / 1000}s`);
}

fs.mkdirSync(STATE, { recursive: true });

console.log('Applying the schema to the throwaway database…');
const schema = run([
	'd1',
	'execute',
	'yomi',
	'--local',
	'--persist-to',
	STATE,
	'--file',
	'./worker/schema.sql'
]);
if (schema.status !== 0) process.exit(schema.status ?? 1);

const worker = spawn(
	process.execPath,
	[
		WRANGLER,
		'dev',
		'--port',
		String(PORT),
		'--ip',
		'127.0.0.1',
		'--persist-to',
		STATE,
		'--var',
		`SYNC_TOKEN:${TOKEN}`
	],
	{ stdio: ['ignore', 'pipe', 'pipe'] }
);

let log = '';
worker.stdout.on('data', (chunk) => {
	log += chunk;
	if (process.env.SMOKE_VERBOSE) process.stdout.write(chunk);
});
worker.stderr.on('data', (chunk) => {
	log += chunk;
	if (process.env.SMOKE_VERBOSE) process.stderr.write(chunk);
});

let exitCode = 1;
try {
	await waitForWorker(`http://127.0.0.1:${PORT}/api/ping`);
	const test = spawnSync(process.execPath, ['scripts/smoke-worker.mjs'], {
		stdio: 'inherit',
		env: { ...process.env, YOMI_URL: `http://127.0.0.1:${PORT}/api`, YOMI_TOKEN: TOKEN }
	});
	exitCode = test.status ?? 1;
	if (exitCode !== 0) {
		const tail = log.trim().split('\n').slice(-20).join('\n');
		if (tail) console.error(`\nWorker log (last 20 lines):\n${tail}`);
	}
} catch (error) {
	console.error(error.message);
	const tail = log.trim().split('\n').slice(-20).join('\n');
	if (tail) console.error(`\nWorker log (last 20 lines):\n${tail}`);
} finally {
	await stop(worker);
	if (!KEEP) {
		// workerd lets go of the SQLite handle a moment after its parent exits.
		await sleep(1500);
		try {
			fs.rmSync(STATE, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
		} catch (error) {
			console.warn(`Could not remove ${STATE}: ${error.message}`);
		}
	}
}

process.exit(exitCode);
