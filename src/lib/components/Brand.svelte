<script lang="ts">
	let { link = true }: { link?: boolean } = $props();
</script>

<svelte:element this={link ? 'a' : 'div'} href={link ? '#/' : undefined} class="brand">
	<span class="hanko" lang="ja" aria-hidden="true">読</span>
	<span class="brand__text">
		<span class="brand__word">Yomi</span>
		<span class="brand__sub">Private reading log</span>
	</span>
</svelte:element>
