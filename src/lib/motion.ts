import { browser } from './browser.ts';

export const prefersReducedMotion =
	browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
