<script lang="ts">
	export type IconName =
		| 'plus'
		| 'close'
		| 'arrow-right'
		| 'arrow-left'
		| 'settings'
		| 'external'
		| 'check'
		| 'trash'
		| 'undo'
		| 'download'
		| 'upload'
		| 'search'
		| 'merge'
		| 'book'
		| 'chart'
		| 'share'
		| 'star';

	let {
		name,
		size = 18,
		stroke = 1.7
	}: { name: IconName; size?: number; stroke?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="square"
	stroke-linejoin="miter"
	aria-hidden="true"
	focusable="false"
>
	{#if name === 'plus'}
		<path d="M12 4v16M4 12h16" />
	{:else if name === 'close'}
		<path d="M6 6l12 12M18 6L6 18" />
	{:else if name === 'arrow-right'}
		<path d="M3 12h17M14 6l6 6-6 6" />
	{:else if name === 'arrow-left'}
		<path d="M21 12H4M10 18l-6-6 6-6" />
	{:else if name === 'settings'}
		<path d="M4 7h6M14 7h6M4 12h11M19 12h1M4 17h3M11 17h9" />
		<circle cx="12" cy="7" r="2" /><circle cx="17" cy="12" r="2" /><circle cx="9" cy="17" r="2" />
	{:else if name === 'external'}
		<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5H5V6h5" />
	{:else if name === 'check'}
		<path d="M4 12.5l5 5L20 6.5" />
	{:else if name === 'trash'}
		<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />
	{:else if name === 'undo'}
		<path d="M9 5L4 10l5 5M4 10h10a6 6 0 0 1 0 12h-2" />
	{:else if name === 'download'}
		<path d="M12 3v13M7 11l5 5 5-5M4 21h16" />
	{:else if name === 'upload'}
		<path d="M12 17V4M7 9l5-5 5 5M4 21h16" />
	{:else if name === 'search'}
		<circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" />
	{:else if name === 'merge'}
		<path d="M4 5h4l4 4v10M20 5h-4l-4 4M4 19h5M15 19h5" />
	{:else if name === 'book'}
		<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4zM18 20H7a3 3 0 0 0-3 3" />
	{:else if name === 'chart'}
		<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
	{:else if name === 'share'}
		<path d="M12 15V3M8 7l4-4 4 4M5 13v7h14v-7" />
	{:else if name === 'star'}
		<path d="M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.9l6-.8z" />
	{/if}
</svg>
