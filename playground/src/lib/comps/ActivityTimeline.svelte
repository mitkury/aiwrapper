<script lang="ts">
	import { activityTimeline } from '$lib/realtime/activity-timeline';
	import { duration, type RoundTiming, type TurnTiming } from '$lib/realtime/turn-timeline';
	let { turn, round, now }: { turn: TurnTiming; round?: RoundTiming; now: number } = $props();
	const chart = $derived(activityTimeline(turn, round, now));
	let selected = $state('');
	const detail = $derived(chart.lanes.find((l) => l.label === selected));
	const stopLabel = $derived(
		chart.reason === 'session-ended'
			? 'Session ended'
			: chart.reason === 'error'
				? 'Session error'
				: 'Interrupted by user'
	);
	const position = (at: number) => Math.max(0, ((at - chart.origin) / chart.span) * 100);
</script>

<section
	class="activity-chart"
	class:failure={chart.reason === 'error'}
	aria-label="Parallel activity timeline"
>
	<div class="heading">
		<strong>What happened, and when</strong><span>One shared time axis · from turn start</span>
	</div>
	{#if chart.stop !== undefined}<p class="stop-caption">
			{stopLabel} at +{duration(Math.max(0, chart.stop - chart.origin))}
		</p>{/if}
	{#if chart.stop !== undefined && chart.reason === 'interrupted'}
		<p class="stop-explanation">
			User input or Stop reply ended the response. Microphone sounds detected as speech can trigger
			this before any words are transcribed.
		</p>
	{/if}
	<div class="plot">
		{#each chart.lanes as lane}
			<button
				class="activity-row"
				class:selected={selected === lane.label}
				aria-pressed={selected === lane.label}
				onclick={() => (selected = selected === lane.label ? '' : lane.label)}
				title={lane.description}
			>
				<span class="label">{lane.label}</span>
				<span class="track">
					{#if lane.from !== undefined && lane.to !== undefined}<span
							class="activity-bar"
							class:active={lane.active}
							class:cut={lane.cut}
							style:left={`${position(lane.from)}%`}
							style:width={`${Math.max(0, ((lane.to - lane.from) / chart.span) * 100)}%`}
							style:background-color={lane.color}
						></span>{/if}
				</span>
				<span class="duration"
					>{lane.from !== undefined && lane.to !== undefined
						? duration(lane.to - lane.from)
						: '—'}{#if lane.active}<small>in progress</small>{/if}</span
				>
			</button>
		{/each}
		{#if chart.stop !== undefined}<div class="marker-area" aria-hidden="true">
				<span class="stop-line" style:left={`${position(chart.stop)}%`}></span>
			</div>{/if}
	</div>
	<div class="axis">
		{#each [0, 1, 2, 3, 4] as i}<span>{i === 0 ? '0' : duration((chart.span * i) / 4)}</span>{/each}
	</div>
	{#if detail}<div class="detail">
			<strong>{detail.label}</strong> · {detail.description}
			{#if detail.from !== undefined && detail.to !== undefined}<span
					>+{duration(detail.from - chart.origin)} → +{duration(
						detail.to - chart.origin
					)}{detail.cut
						? ` · ${stopLabel.toLowerCase()}`
						: detail.active
							? ' · in progress'
							: ''}</span
				>{/if}
		</div>{:else}<p class="hint">
			Bars aligned vertically happened at the same time. Select a lane for details.
		</p>{/if}
</section>

<style>
	.activity-chart {
		--stop-color: #94621d;
		--label: 150px;
		--value: 85px;
		--gap: 14px;
		margin: 24px 0 14px;
		color: #35474e;
	}
	.activity-chart.failure {
		--stop-color: #a13f3a;
	}
	.stop-explanation {
		font-size: 12px;
		color: #73818a;
		margin-bottom: 12px;
	}
	.heading {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 13px;
		margin-bottom: 16px;
	}
	.heading span {
		color: #73818a;
		font-size: 11px;
	}
	.plot {
		position: relative;
	}
	.activity-row {
		display: grid;
		grid-template-columns: var(--label) minmax(0, 1fr) var(--value);
		gap: var(--gap);
		align-items: center;
		width: 100%;
		min-height: 43px;
		border-radius: 5px;
		text-align: left;
		cursor: pointer;
		font-size: 12px;
	}
	.activity-row:hover,
	.activity-row.selected {
		background: #f2f6f5;
	}
	.activity-row:focus-visible {
		outline: 2px solid #176957;
		outline-offset: 2px;
	}
	.track {
		height: 23px;
		position: relative;
		background-color: #f0f3f4;
		background-image: linear-gradient(to right, #dce3e5 1px, transparent 1px);
		background-size: 25% 100%;
		border-radius: 3px;
		overflow: hidden;
	}
	.activity-bar {
		position: absolute;
		height: 100%;
		min-width: 2px;
		border-radius: 3px;
	}
	.activity-bar.active {
		background-image: repeating-linear-gradient(
			120deg,
			transparent,
			transparent 7px,
			#ffffff35 7px,
			#ffffff35 10px
		);
	}
	.activity-bar.cut {
		border-right: 3px solid var(--stop-color);
	}
	.duration {
		text-align: right;
		font-variant-numeric: tabular-nums;
		padding-right: 3px;
	}
	.duration small {
		display: block;
		font-size: 10px;
		color: #78858c;
	}
	.axis,
	.marker-area {
		margin-left: calc(var(--label) + var(--gap));
		margin-right: calc(var(--value) + var(--gap));
	}
	.axis {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		color: #73818a;
		margin-top: 8px;
	}
	.marker-area {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.stop-line {
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: 2px dashed var(--stop-color);
	}
	.stop-caption {
		font-size: 12px;
		color: var(--stop-color);
		margin-bottom: 8px;
	}
	.hint,
	.detail {
		font-size: 12px;
		line-height: 1.6;
		color: #73818a;
		margin-top: 16px;
	}
	.detail {
		padding: 12px;
		border-radius: 6px;
		background: #f4f7f7;
	}
	.detail span {
		display: block;
		font-variant-numeric: tabular-nums;
		margin-top: 4px;
	}
	@media (max-width: 600px) {
		.activity-chart {
			--label: 85px;
			--value: 58px;
			--gap: 6px;
		}
		.activity-row {
			font-size: 10px;
			min-height: 46px;
		}
		.track {
			height: 22px;
		}
		.duration small {
			font-size: 9px;
		}
		.axis {
			font-size: 9px;
		}
	}
</style>
