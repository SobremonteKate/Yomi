/**
 * Renders a dialog at the document root. A fixed dialog inside the animated
 * page view is positioned against that long container, not the viewport, which
 * leaves it off-screen on phones.
 */
export function portal(node: HTMLElement): { destroy: () => void } {
	if (typeof document === 'undefined') return { destroy: () => {} };
	document.body.appendChild(node);
	return {
		destroy: () => node.remove()
	};
}
