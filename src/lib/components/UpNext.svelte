<script lang="ts">
	import { chapterText } from '../../../shared/model.ts';
	import { app } from '../app.svelte.ts';
	import Cover from './Cover.svelte';
	import Icon from './Icon.svelte';

	const queue = $derived(app.queue.slice(0, 5));
</script>

{#if queue.length > 0}
	<section class="up-next" aria-labelledby="up-next-title">
		<header class="up-next__head">
			<div>
				<p class="eyebrow eyebrow--ink">Up next</p>
				<h2 class="up-next__title" id="up-next-title">
					{app.queue.length}
					{app.queue.length === 1 ? 'series waiting' : 'series waiting'}
				</h2>
			</div>
			<p class="up-next__hint">The order you set, not the clock.</p>
		</header>

		<ol class="queue">
			{#each queue as entry, index (entry.series.id)}
				{@const stats = app.statsFor(entry.series)}
				{@const link = app.readingLinkFor(entry.series)}
				<li class="queue__row">
					<span class="queue__no mono">{String(index + 1).padStart(2, '0')}</span>
					<a class="queue__art" href={`#/s/${entry.series.id}`} aria-hidden="true" tabindex="-1">
						<Cover url={entry.series.cover_url} title={entry.series.title} size="sm" />
					</a>
					<div class="queue__copy">
						<a class="queue__name" href={`#/s/${entry.series.id}`}>{entry.series.title}</a>
						<p class="queue__meta">
							{#if stats.furthest !== null}
								at ch. {chapterText(stats.furthest)}
								{#if entry.series.total_chapters}
									of {entry.series.total_chapters}
								{/if}
							{:else}
								not started
							{/if}
							{#if entry.series.description}
								<span class="dot">/</span>
								<span class="queue__blurb">{entry.series.description}</span>
							{/if}
						</p>
					</div>
					<div class="queue__actions">
						<button
							class="queue__icon"
							onclick={() => app.moveInQueue(entry.series.id, -1)}
							disabled={index === 0}
							aria-label={`Move ${entry.series.title} up`}
							title="Move up"
						>
							<span class="rot rot--up"><Icon name="arrow-left" size={12} /></span>
						</button>
						<button
							class="queue__icon"
							onclick={() => app.moveInQueue(entry.series.id, 1)}
							disabled={index === app.queue.length - 1}
							aria-label={`Move ${entry.series.title} down`}
							title="Move down"
						>
							<span class="rot rot--down"><Icon name="arrow-left" size={12} /></span>
						</button>
						{#if link}
							<a
								class="queue__icon queue__open"
								href={link.url}
								target="_blank"
								rel="noreferrer"
								title={link.url}
								aria-label={`${app.readingLabel(link)} of ${entry.series.title}`}
							>
								<Icon name="external" size={12} />
							</a>
						{/if}
						<button
							class="btn btn--sm queue__start"
							onclick={() => app.startQueued(entry.series)}
							title="Move to Reading and open"
						>
							Start
						</button>
						<button
							class="queue__icon"
							onclick={() => app.queueRemove(entry.series)}
							aria-label={`Remove ${entry.series.title} from Up next`}
							title="Remove from queue"
						>
							<Icon name="close" size={12} />
						</button>
					</div>
				</li>
			{/each}
		</ol>

		{#if app.queue.length > queue.length}
			<p class="up-next__more mono">
				+{app.queue.length - queue.length} more in the queue · reorder any of them from its series page
			</p>
		{/if}
	</section>
{/if}

<style>
	.up-next {
		margin-top: clamp(20px, 3vw, 30px);
		border: 1.5px solid var(--ink);
		background: var(--paper);
	}

	.up-next__head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		padding: 12px 14px;
		border-bottom: 1.5px solid var(--ink);
		background: var(--paper-2);
	}

	.up-next__title {
		margin-top: 2px;
		font-family: var(--display);
		font-size: 22px;
		font-weight: 400;
		line-height: 1;
		letter-spacing: -0.02em;
	}

	.up-next__hint {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.queue {
		display: flex;
		flex-direction: column;
	}

	.queue__row {
		display: grid;
		grid-template-columns: 22px 30px minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--rule);
	}

	.queue__row:last-child {
		border-bottom: 0;
	}

	.queue__no {
		font-size: 9px;
		color: var(--ink-3);
	}

	.queue__art {
		display: block;
	}

	.queue__copy {
		min-width: 0;
	}

	.queue__name {
		display: inline;
		font-size: 14px;
		font-weight: 700;
		line-height: 1.25;
	}

	.queue__name:hover {
		text-decoration: underline;
		text-decoration-color: var(--red);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}

	.queue__meta {
		display: flex;
		align-items: baseline;
		gap: 5px;
		margin-top: 2px;
		font-family: var(--mono);
		font-size: 8.5px;
		color: var(--ink-3);
		min-width: 0;
	}

	.queue__blurb {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.8;
	}

	.dot {
		opacity: 0.5;
	}

	.queue__actions {
		display: flex;
		align-items: center;
		gap: 3px;
	}		.queue__icon {
			display: grid;
			place-items: center;
			width: 24px;
			height: 26px;
			border: 1px solid var(--rule);
			color: var(--ink-2);
		}

		.queue__open {
			color: var(--ink);
			border-color: var(--ink);
		}

	.queue__icon:hover:not(:disabled) {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--paper);
	}

	.queue__icon:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.rot {
		display: inline-flex;
	}

	.rot--up {
		transform: rotate(90deg);
	}

	.rot--down {
		transform: rotate(-90deg);
	}

	.queue__start {
		height: 26px;
		margin-inline: 2px;
	}

	.up-next__more {
		padding: 7px 12px;
		border-top: 1px solid var(--rule);
		font-size: 8px;
		letter-spacing: 0.06em;
		color: var(--ink-3);
	}

	@media (max-width: 620px) {
		.queue__row {
			grid-template-columns: 18px 28px minmax(0, 1fr);
			grid-template-areas:
				'no art copy'
				'. . actions';
			padding: 9px 10px;
		}

		.queue__no {
			grid-area: no;
		}

		.queue__art {
			grid-area: art;
		}

		.queue__copy {
			grid-area: copy;
		}

		.queue__actions {
			grid-area: actions;
			justify-content: flex-end;
			margin-top: 4px;
			gap: 5px;
		}

		.queue__icon,
		.queue__start {
			min-height: 32px;
		}

		.queue__icon {
			width: 32px;
			height: 32px;
		}

		.up-next__hint {
			display: none;
		}
	}
</style>
