<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { app } from '../app.svelte.ts';
	import { prefersReducedMotion } from '../motion.ts';
	import Icon from './Icon.svelte';
</script>

{#if app.toast}
	{@const toast = app.toast}
	<div
		class="toast"
		role="status"
		aria-live="polite"
		in:fly={{ y: 14, duration: prefersReducedMotion ? 0 : 180 }}
		out:fade={{ duration: prefersReducedMotion ? 0 : 120 }}
	>
		<span class="toast__bar" aria-hidden="true"></span>
		<div class="toast__body">
			<p class="toast__text">{toast.text}</p>
			{#if toast.detail}
				<p class="toast__detail">{toast.detail}</p>
			{/if}
		</div>
		{#if toast.action}
			<button class="toast__action" onclick={() => app.runToastAction()}>
				{toast.action.label}
			</button>
		{/if}
		<button class="toast__close" aria-label="Dismiss" onclick={() => app.dismissToast()}>
			<Icon name="close" size={14} />
		</button>
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		left: 24px;
		bottom: calc(24px + env(safe-area-inset-bottom, 0px));
		z-index: 80;
		display: flex;
		align-items: center;
		gap: 10px;
		width: min(440px, calc(100vw - 32px));
		padding: 12px 12px 12px 0;
		background: var(--ink);
		color: var(--paper);
		border: 1.5px solid var(--ink);
		box-shadow: var(--shadow);
	}

	.toast__bar {
		align-self: stretch;
		width: 5px;
		background: var(--red);
		animation: yomi-sweep 240ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
	}

	.toast__body {
		min-width: 0;
		flex: 1;
		padding-left: 3px;
	}

	.toast__text {
		font-family: var(--mono);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.03em;
		line-height: 1.4;
		text-transform: uppercase;
	}

	.toast__detail {
		margin-top: 2px;
		font-size: 12px;
		line-height: 1.35;
		opacity: 0.72;
		overflow-wrap: anywhere;
	}

	.toast__action {
		flex: 0 0 auto;
		min-height: 30px;
		padding: 5px 9px;
		border: 1px solid color-mix(in srgb, var(--paper) 40%, transparent);
		color: var(--paper);
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.toast__action:hover {
		background: var(--paper);
		color: var(--ink);
	}

	.toast__close {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		color: var(--paper);
		opacity: 0.6;
	}

	.toast__close:hover {
		opacity: 1;
	}

	/* The phone dock sits under the toast; keep the Undo action above it. */
	@media (max-width: 700px) {
		.toast {
			bottom: calc(68px + env(safe-area-inset-bottom, 0px));
		}
	}

	@media (max-width: 560px) {
		.toast {
			left: 16px;
		}
	}
</style>
