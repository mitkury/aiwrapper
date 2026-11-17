<script lang="ts">
	import { ChartNoAxesGantt, ChevronDown } from 'lucide-svelte';
	import FrameReview from './FrameReview.svelte';
	import { duration, finished, type TurnTiming } from '$lib/realtime/turn-timeline';
	import type { ComponentProps } from 'svelte';
	let {
		turns,
		requests
	}: {
		turns: TurnTiming[];
		requests: (ComponentProps<typeof FrameReview>['requests'][number] & { itemId: string })[];
	} = $props();
	let open = $state(false);
	let chosen = $state(0);
	let roundIndex = $state(-1);
	$effect(() => {
		if (!turns.length || (chosen && !turns.some((t) => t.id === chosen))) {
			chosen = 0;
			roundIndex = -1;
		}
	});
	const turn = $derived(turns.find((t) => t.id === chosen) ?? turns.at(-1));
	const round = $derived(turn?.rounds[roundIndex] ?? turn?.rounds.at(-1));
	const firstPlayback = $derived(turn?.rounds.find((r) => r.play !== undefined)?.play);
	const previousRound = $derived(
		turn && round ? turn.rounds[turn.rounds.indexOf(round) - 1] : undefined
	);
	const frameRequest = $derived(requests.find((r) => r.itemId === round?.id));
	const origin = $derived(turn?.start ?? 0);
	const stages = $derived(
		turn
			? [
					{
						label: turn.kind === 'speech' ? 'Input & transcription' : 'Send input',
						from: turn.start,
						to: turn.ready,
						color: '#718a9a'
					},
					{
						label: previousRound ? 'Tool / continuation wait' : 'Prepare request',
						from: previousRound ? previousRound.modelEnd : turn.ready,
						to: round?.request,
						color: '#9aabc1'
					},
					{ label: 'Model → first text', from: round?.request, to: round?.text, color: '#427b91' },
					{ label: 'Buffer speech text', from: round?.text, to: round?.tts, color: '#a38754' },
					{ label: 'Speech → first audio', from: round?.tts, to: round?.audio, color: '#6e7dae' },
					{ label: 'Playback queue', from: round?.audio, to: round?.play, color: '#68a18e' }
				]
			: []
	);
	const range = $derived(
		Math.max(1, ...stages.flatMap((s) => [s.from ?? origin, s.to ?? origin])) - origin || 1
	);
	const playbackEnd = $derived(round?.stopped ?? round?.end);
	const status = $derived(
		turn?.stopped !== undefined || round?.stopped !== undefined
			? 'Stopped / interrupted'
			: round && finished(round)
				? 'Complete'
				: round?.play !== undefined
					? 'Playing reply'
					: turn?.ready !== undefined
						? 'Processing'
						: 'Receiving input'
	);
</script>

<details class="timeline" bind:open>
	<summary
		><ChartNoAxesGantt size={19} /><span
			><strong>Turn timeline</strong><small>Speech, response timing, and selected frames</small
			></span
		><span class="count">{turns.length} {turns.length === 1 ? 'turn' : 'turns'}</span><ChevronDown
			size={17}
		/></summary
	>
	{#if open}
		<div class="content">
			{#if turn}
				<div class="toolbar">
					<label
						>Turn<select
							aria-label="Timeline turn"
							value={chosen}
							onchange={(e) => {
								chosen = Number(e.currentTarget.value);
								roundIndex = -1;
							}}
						>
							<option value={0}>Follow latest turn</option>
							{#each turns as t}<option value={t.id}
									>#{t.id} · {t.label || 'Speech detected'}</option
								>{/each}
						</select></label
					>
					{#if turn.rounds.length > 1}<label
							>Model request<select aria-label="Timeline model request" bind:value={roundIndex}
								><option value={-1}>Latest request</option>{#each turn.rounds as r, i}<option
										value={i}
										>{i + 1} of {turn.rounds.length} · {(r.request / 1000).toFixed(2)}s</option
									>{/each}</select
							></label
						>{/if}
					<span class="status">{status}</span>
				</div>
				<p class="utterance">“{turn.label || 'Waiting for a transcript…'}”</p>
				<div class="metrics">
					<div>
						<small
							>{turn.kind === 'speech'
								? 'Transcript ready → first playback'
								: 'Send → first playback'}</small
						><strong
							>{firstPlayback !== undefined
								? duration(
										Math.max(
											0,
											firstPlayback -
												(turn.kind === 'typed' ? turn.start : (turn.ready ?? turn.start))
										)
									)
								: '—'}</strong
						>
					</div>
					<div>
						<small>Playback span{round?.stopped !== undefined ? ' · interrupted' : ''}</small
						><strong
							>{round?.play !== undefined && playbackEnd !== undefined
								? duration(Math.max(0, playbackEnd - round.play))
								: '—'}</strong
						>
					</div>
					<div><small>Selected frames</small><strong>{round?.frames ?? '—'}</strong></div>
				</div>
				<div class="chart" aria-label="Response latency stages">
					<div class="chart-heading">
						<span>Until first playback</span><span>From turn start</span>
					</div>
					{#each stages as stage}
						<div class="stage">
							<span>{stage.label}</span>
							<div class="track">
								{#if stage.from !== undefined && stage.to !== undefined}<i
										style:left={`${Math.max(0, ((stage.from - origin) / range) * 100)}%`}
										style:width={`${Math.max(0, ((stage.to - stage.from) / range) * 100)}%`}
										style:background={stage.color}
									></i>{/if}
							</div>
							<span class="duration"
								>{stage.from !== undefined && stage.to !== undefined
									? duration(Math.max(0, stage.to - stage.from))
									: '—'}</span
							>
						</div>
					{/each}
					<div class="axis"><span>0</span><span>{duration(range)}</span></div>
				</div>
				<p class="note">Observed in the browser · input includes speech and turn detection.</p>
				{#if round}
					<details class="milestones">
						<summary>Event times <small>· session clock</small></summary>
						<p class="note">
							Timings include transport, not isolated provider processing. Playback uses the audio
							render clock; device output latency is not measured. Streaming stages can overlap.
						</p>
						<dl>
							{#each [['Input started', turn.start], ['Transcript ready', turn.ready], ['Model request observed', round.request], ['First model text', round.text], ['First speech request', round.tts], ['First audio received', round.audio], ['First playback', round.play], ['Model finished', round.modelEnd], ['Speech generation finished', round.synthesisEnd], ['Playback drained', round.end], ['Stopped / interrupted', round.stopped]] as [label, time]}
								{#if typeof time === 'number'}<div>
										<dt>{label}</dt>
										<dd>{(time / 1000).toFixed(3)}s</dd>
									</div>{/if}
							{/each}
						</dl>
					</details>
					<div class="frames-heading">
						<strong>Visual context</strong><span
							>Request observed at {(round.request / 1000).toFixed(2)}s</span
						>
					</div>
					<p class="note">
						Capture order · session timestamps. Frames may predate this turn; strip spacing is not
						to scale.
					</p>
					{#if frameRequest}<FrameReview requests={[frameRequest]} compact />
					{:else}<p class="empty">
							{round.frames
								? 'Frame previews were evicted from the bounded image store. Timing and frame counts are retained.'
								: 'No camera frames attached to this request.'}
						</p>{/if}
				{/if}
			{:else}<p class="empty">
					Start a session and speak or send a message. Each turn’s timing and selected frames appear
					here.
				</p>{/if}
			<p class="retention">
				Last 80 turns · previews: 8 requests / 16 MiB. Cleared when starting a new session.
			</p>
		</div>
	{/if}
</details>

<style>
	.timeline {
		scroll-margin-top: 170px;
		border: 1px solid #dce3e5;
		border-radius: 12px;
		background: white;
		min-width: 0;
	}
	summary {
		display: flex;
		align-items: center;
		gap: 16px;
		cursor: pointer;
		padding: 22px;
		color: #35474e;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary > span:first-of-type {
		flex: 1;
	}
	summary strong,
	summary small {
		display: block;
	}
	summary strong {
		font-size: 14px;
	}
	summary small {
		font-size: 12px;
		color: #78858c;
		margin-top: 4px;
	}
	.count {
		font-size: 12px;
		color: #78858c;
	}
	.content {
		padding: 0 22px 22px;
	}
	.toolbar {
		display: flex;
		align-items: end;
		gap: 16px;
		flex-wrap: wrap;
	}
	label {
		display: grid;
		gap: 6px;
		font-size: 12px;
		color: #5e7078;
		min-width: 0;
	}
	label:first-child {
		flex: 1;
	}
	select {
		width: 100%;
		border: 1px solid #dce3e5;
		border-radius: 7px;
		padding: 9px 28px 9px 10px;
		font-size: 13px;
		color: #24363e;
		text-overflow: ellipsis;
	}
	.status {
		padding: 10px 0;
		font-size: 12px;
		color: #176957;
	}
	.utterance {
		margin: 18px 0;
		font-size: 15px;
		color: #24363e;
		overflow-wrap: anywhere;
	}
	.metrics {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr;
		gap: 12px;
		margin-bottom: 24px;
	}
	.metrics > div {
		background: #f4f7f7;
		padding: 14px;
		border-radius: 8px;
	}
	.metrics small {
		display: block;
		font-size: 12px;
		color: #5e7078;
	}
	.metrics strong {
		display: block;
		font-size: 24px;
		font-weight: 600;
		color: #24363e;
		margin-top: 7px;
	}
	.chart-heading {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: #78858c;
		margin-bottom: 14px;
	}
	.stage {
		display: grid;
		grid-template-columns: 165px minmax(0, 1fr) 75px;
		align-items: center;
		gap: 14px;
		padding: 7px 0;
		font-size: 12px;
		color: #35474e;
	}
	.track {
		height: 16px;
		background: #f3f5f6;
		position: relative;
		border-radius: 3px;
		overflow: hidden;
	}
	.track i {
		display: block;
		position: absolute;
		height: 100%;
		min-width: 2px;
		border-radius: 3px;
	}
	.duration {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		margin: 4px 89px 16px 179px;
		font-size: 10px;
		color: #78858c;
	}
	.note,
	.retention,
	.empty {
		font-size: 12px;
		color: #73818a;
		line-height: 1.6;
	}
	.retention {
		border-top: 1px solid #edf0f1;
		padding-top: 16px;
		margin-top: 20px;
	}
	.empty {
		padding: 18px 0;
	}
	.milestones {
		margin: 16px 0 24px;
		border-bottom: 1px solid #edf0f1;
	}
	.milestones summary {
		padding: 10px 0;
		font-size: 12px;
		gap: 6px;
	}
	.milestones small {
		margin: 0;
	}
	dl {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px 28px;
		padding-bottom: 16px;
		font-size: 12px;
	}
	dl div {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	dd {
		font-variant-numeric: tabular-nums;
		color: #5e7078;
	}
	.frames-heading {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 13px;
		color: #35474e;
		margin-bottom: 6px;
	}
	.frames-heading span {
		font-size: 12px;
		color: #73818a;
	}
	@media (max-width: 600px) {
		.content {
			padding: 0 14px 16px;
		}
		summary {
			padding: 18px 14px;
			gap: 10px;
		}
		.count {
			display: none;
		}
		.metrics {
			grid-template-columns: 1fr 1fr;
		}
		.metrics > div:first-child {
			grid-column: 1 / -1;
		}
		.stage {
			grid-template-columns: 122px minmax(0, 1fr) 56px;
			gap: 6px;
			font-size: 10px;
		}
		.axis {
			margin-left: 128px;
			margin-right: 62px;
		}
		dl {
			grid-template-columns: 1fr;
		}
	}
</style>
