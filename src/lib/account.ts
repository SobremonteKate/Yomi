import type {
	AccountInfo,
	PingResponse,
	ShareCreateResponse,
	ShareViewResponse,
	SignupResponse
} from '../../shared/protocol.ts';
import { resolveEndpoint } from './sync.ts';

export interface AccountResult<T> {
	ok: boolean;
	message: string;
	data?: T;
}

async function request(
	endpointRaw: string,
	path: string,
	init: RequestInit = {},
	token?: string
): Promise<Response> {
	const endpoint = resolveEndpoint(endpointRaw);
	if (!endpoint) throw new Error('Enter a valid Worker address first.');
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (token) headers.Authorization = `Bearer ${token}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		return await fetch(`${endpoint}${path}`, {
			...init,
			headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
			signal: controller.signal
		});
	} finally {
		clearTimeout(timer);
	}
}

async function readError(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: string; detail?: string };
		return [body.error, body.detail].filter(Boolean).join(' — ') || `HTTP ${response.status}`;
	} catch {
		return `HTTP ${response.status}`;
	}
}

/** Who the saved token belongs to, straight from the Worker. */
export async function pingAccount(
	endpoint: string,
	token: string
): Promise<AccountResult<AccountInfo>> {
	if (!token.trim()) return { ok: false, message: 'No token saved yet.' };
	try {
		const response = await request(endpoint, '/ping', { method: 'GET' }, token.trim());
		if (response.status === 401) {
			return { ok: false, message: 'The Worker rejected that token.' };
		}
		if (!response.ok) return { ok: false, message: await readError(response) };
		const data = (await response.json()) as PingResponse;
		if (!data?.ok || !data.account) {
			return { ok: false, message: 'This Worker is older than the app. Deploy the current worker.' };
		}
		return { ok: true, message: 'Connected.', data: data.account };
	} catch {
		return { ok: false, message: 'Could not reach that address. Check the URL and connection.' };
	}
}

/** Creates an account and returns its one-time token. */
export async function createAccount(
	endpoint: string,
	username: string,
	invite = ''
): Promise<AccountResult<{ token: string; account: AccountInfo }>> {
	try {
		const response = await request(endpoint, '/signup', {
			method: 'POST',
			body: JSON.stringify({ username, invite })
		});
		if (!response.ok) return { ok: false, message: await readError(response) };
		const data = (await response.json()) as SignupResponse;
		if (!data?.ok || !data.token) {
			return { ok: false, message: 'The Worker sent an unexpected signup response.' };
		}
		return {
			ok: true,
			message: 'Account created.',
			data: {
				token: data.token,
				account: { ...data.account, legacy: false }
			}
		};
	} catch {
		return { ok: false, message: 'Could not reach that address. Check the URL and connection.' };
	}
}

/** The existing active share token, creating one the first time it is asked for. */
export async function createShareLink(
	endpoint: string,
	token: string
): Promise<AccountResult<string>> {
	try {
		const response = await request(endpoint, '/share', { method: 'POST' }, token.trim());
		if (!response.ok) return { ok: false, message: await readError(response) };
		const data = (await response.json()) as ShareCreateResponse;
		if (!data?.ok || !data.token) return { ok: false, message: 'Could not create a link.' };
		return { ok: true, message: 'Link ready.', data: data.token };
	} catch {
		return { ok: false, message: 'Could not reach the Worker.' };
	}
}

export async function revokeShareLink(
	endpoint: string,
	token: string
): Promise<AccountResult<true>> {
	try {
		const response = await request(endpoint, '/share', { method: 'DELETE' }, token.trim());
		if (!response.ok) return { ok: false, message: await readError(response) };
		return { ok: true, message: 'Link turned off.' };
	} catch {
		return { ok: false, message: 'Could not reach the Worker.' };
	}
}

/** Reads a public share snapshot. No token and no account required. */
export async function fetchShare(
	endpoint: string,
	shareToken: string
): Promise<AccountResult<ShareViewResponse>> {
	try {
		const response = await request(
			endpoint,
			`/share/${encodeURIComponent(shareToken)}`,
			{ method: 'GET' }
		);
		if (!response.ok) {
			return {
				ok: false,
				message:
					response.status === 404
						? 'This link is off or no longer exists.'
						: await readError(response)
			};
		}
		const data = (await response.json()) as ShareViewResponse;
		if (!data?.ok || !Array.isArray(data.series)) {
			return { ok: false, message: 'The Worker sent an unexpected share response.' };
		}
		return { ok: true, message: 'Loaded.', data };
	} catch {
		return { ok: false, message: 'Could not reach the Worker that hosts this shelf.' };
	}
}
