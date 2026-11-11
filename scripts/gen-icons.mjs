/**
 * Generates the Yomi app icons without a native canvas dependency.
 * The mark is a maru (chapter ring) with a red "next" chevron inside it.
 *
 *   node scripts/gen-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PAPER = [0xed, 0xed, 0xe4];
const INK = [0x14, 0x14, 0x11];
const RED = [0xee, 0x3b, 0x1f];

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buffer) {
	let c = 0xffffffff;
	for (let index = 0; index < buffer.length; index += 1) {
		c = CRC_TABLE[(c ^ buffer[index]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // RGBA
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y += 1) {
		raw[y * (stride + 1)] = 0; // filter: none
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const length = dx * dx + dy * dy;
	const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
	const cx = ax + t * dx;
	const cy = ay + t * dy;
	return Math.hypot(px - cx, py - cy);
}

function design(size, { inverse = false, scale = 1 } = {}) {
	const background = inverse ? INK : PAPER;
	const ring = inverse ? PAPER : INK;
	const chevron = RED;
	const rgba = Buffer.alloc(size * size * 4);
	const samples = 3;
	const total = samples * samples;

	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			for (let sy = 0; sy < samples; sy += 1) {
				for (let sx = 0; sx < samples; sx += 1) {
					const px = (x + (sx + 0.5) / samples) / size;
					const py = (y + (sy + 0.5) / samples) / size;
					// Map into the mark's own coordinate space around the centre.
					const mx = (px - 0.5) / scale + 0.5;
					const my = (py - 0.5) / scale + 0.5;
					const dx = mx - 0.5;
					const dy = my - 0.5;
					const radius = Math.hypot(dx, dy);

					let colour = background;
					if (Math.abs(radius - 0.3) <= 0.0375) colour = ring;
					const chevronWidth = 0.055;
					const nearChevron =
						distanceToSegment(mx, my, 0.455, 0.335, 0.605, 0.5) <= chevronWidth ||
						distanceToSegment(mx, my, 0.605, 0.5, 0.455, 0.665) <= chevronWidth;
					if (nearChevron) colour = chevron;

					r += colour[0];
					g += colour[1];
					b += colour[2];
				}
			}
			const offset = (y * size + x) * 4;
			rgba[offset] = Math.round(r / total);
			rgba[offset + 1] = Math.round(g / total);
			rgba[offset + 2] = Math.round(b / total);
			rgba[offset + 3] = 255;
		}
	}
	return encodePng(size, size, rgba);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Yomi">
	<rect width="512" height="512" fill="#EDEDE4"/>
	<circle cx="256" cy="256" r="153.6" fill="none" stroke="#141411" stroke-width="38.4"/>
	<polyline points="233,171 310,256 233,341" fill="none" stroke="#EE3B1F" stroke-width="56" stroke-linecap="square" stroke-linejoin="miter"/>
</svg>
`;

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon.svg', svg);
writeFileSync('public/icons/icon-192.png', design(192));
writeFileSync('public/icons/icon-512.png', design(512));
writeFileSync('public/icons/maskable-512.png', design(512, { inverse: true, scale: 0.82 }));
writeFileSync('public/icons/apple-touch-icon.png', design(180));

console.log('icons written to public/icons');
