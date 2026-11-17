<script lang="ts">
	import { ChartNoAxesGantt, ChevronDown } from 'lucide-svelte';
	import FrameReview from './FrameReview.svelte';
	import ActivityTimeline from './ActivityTimeline.svelte';
	import { duration, finished, type TurnTiming } from '$lib/realtime/turn-timeline';
	import { tick } from 'svelte';
	import RequestInspector from './RequestInspector.svelte';
	import ProviderRequestView from './ProviderRequestView.svelte';
	import { cameraRequest, type RequestSnapshot } from '$lib/realtime/request-snapshot';
	let {
		turns,
		requests,
		elapsed
	}: {
		turns: TurnTiming[];
		requests: RequestSnapshot[];
		elapsed: () => number;
	} = $props();
	let open = $state(false);
	let view = $state<'timing' | 'request' | 'provider'>('timing');
	let panel: HTMLDetailsElement;
	export function inspect(turnId: number) {
		chosen = turnId;
		roundIndex = -1;
		view = 'request';
		open = true;
		void tick().then(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }));
	}
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
	const request = $derived(requests.find((r) => r.itemId === round?.id));
	const frameRequest = $derived(request ? cameraRequest(request) : undefined);
	let now = $state(0);
	$effect(() => {
		if (
			!open ||
			view !== 'timing' ||
			!turn ||
			(round ? finished(round) : turn.stopped !== undefined || turn.ready !== undefined)
		)
			return;
		now = elapsed();
		const timer = setInterval(() => (now = elapsed()), 100);
		return () => clearInterval(timer);
	});
	const stages = $derived(
		turn
			? [
					{
						label: turn.kind === 'speech' ? 'Input & transcription' : 'Send input',
						from: turn.start,
						to: turn.ready
					},
					{
						label: previousRound ? 'Tool / continuation wait' : 'Prepare request',
						from: previousRound ? previousRound.modelEnd : turn.ready,
						to: round?.request
					},
					{ label: 'Model → first text', from: round?.request, to: round?.text },
					{ label: 'Buffer speech text', from: round?.text, to: round?.tts },
					{ label: 'Speech → first audio', from: round?.tts, to: round?.audio },
					{ label: 'Playback queue', from: round?.audio, to: round?.play }
				]
			: []
	);
	const playbackEnd = $derived(round?.end ?? round?.stopped ?? now);
	const modelEnd = $derived(round?.modelEnd ?? round?.stopped ?? now);
	const status = $derived(
		(round ? round.stopped !== undefined : turn?.stopped !== undefined)
			? (round?.stopReason ?? turn?.stopReason) === 'session-ended'
				? 'Session ended'
				: (round?.stopReason ?? turn?.stopReason) === 'error'
					? 'Session error'
					: 'Interrupted by user'
			: round && finished(round)
				? 'Complete'
				: round?.play !== undefined
					? 'Playing reply'
					: turn?.ready !== undefined
						? 'Processing'
						: 'Receiving input'
	);
</script>

<details class="timeline" bind:open bind:this={panel}>
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
				<nav aria-label="Request view" class="views">
					<button aria-pressed={view === 'timing'} onclick={() => (view = 'timing')}>Timing</button
					><button aria-pressed={view === 'request'} onclick={() => (view = 'request')}
						>Sent to model</button
					>
					<button aria-pressed={view === 'provider'} onclick={() => (view = 'provider')}
						>Provider JSON</button
					>
				</nav>
				{#if view === 'provider'}
					{#key round?.id}<ProviderRequestView
							wire={request?.wire}
							retained={Boolean(request)}
							requested={Boolean(round)}
						/>{/key}
				{:else if view === 'request'}
					{#if request}{#key request.itemId}<RequestInspector {request} />{/key}
					{:else}<p class="empty">
							{round
								? 'This request snapshot was evicted from the bounded store. Its timing is still available.'
								: 'Waiting for the model request. The input is still being processed.'}
						</p>{/if}
				{:else}
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
							<small
								>Voice reply{round?.stopped !== undefined && round.end === undefined
									? ' · stopped'
									: ''}</small
							><strong
								>{round?.play !== undefined
									? duration(Math.max(0, playbackEnd - round.play))
									: '—'}</strong
							>
						</div>
						<div>
							<small>AI response · wait + generation</small><strong
								>{round ? duration(Math.max(0, modelEnd - round.request)) : '—'}</strong
							>
						</div>
					</div>
					<ActivityTimeline {turn} {round} {now} />
					<details class="latency-breakdown">
						<summary>First-audio latency breakdown</summary>
						{#each stages as stage}<div class="latency-row">
								<span>{stage.label}</span><span
									>{stage.from !== undefined && stage.to !== undefined
										? duration(Math.max(0, stage.to - stage.from))
										: '—'}</span
								>
							</div>{/each}
					</details>
					<p class="note">Observed in the browser · input includes speech and turn detection.</p>
					{#if round}
						<details class="milestones">
							<summary>Event times <small>· session clock</small></summary>
							<p class="note">
								Timings include transport, not isolated provider processing. Playback uses the audio
								render clock; device output latency is not measured. Streaming stages can overlap.
							</p>
							<dl>
								{#each [['Input started', turn.start], ['Transcript ready', turn.ready], ['Model request observed', round.request], ['First model text', round.text], ['First speech request', round.tts], ['First audio received', round.audio], ['First playback', round.play], ['Model finished', round.modelEnd], ['Speech generation finished', round.synthesisEnd], ['Playback drained', round.end], [status, round.stopped]] as [label, time]}
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
				{/if}
			{:else}<p class="empty">
					Start a session and speak or send a message. Each turn’s timing and selected frames appear
					here.
				</p>{/if}
			<p class="retention">
				Last 80 turns · request snapshots: 8 requests / 16 MiB including text and images. Cleared
				when starting a new session.
			</p>
		</div>
	{/if}
</details>

<style>
	.views {
		display: flex;
		gap: 6px;
		border-bottom: 1px solid #e1e7e8;
		padding: 16px 0 8px;
	}
	.views button {
		padding: 7px 12px;
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
		color: #5e7078;
	}
	.views button[aria-pressed='true'] {
		background: #eaf3f0;
		color: #176957;
		font-weight: 600;
	}
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
	.latency-breakdown {
		margin: 16px 0;
		border-bottom: 1px solid #edf0f1;
	}
	.latency-breakdown summary {
		padding: 10px 0;
		font-size: 12px;
	}
	.latency-row {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		padding: 7px 0;
		font-size: 12px;
		color: #5e7078;
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
		dl {
			grid-template-columns: 1fr;
		}
	}
</style>
