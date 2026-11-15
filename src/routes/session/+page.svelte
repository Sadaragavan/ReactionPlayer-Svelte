<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { PlaybackEngine } from '$lib/services/playback';
	import type { SessionVideo, LayoutType, ID } from '$lib/types';

	const browser = typeof window !== 'undefined';

	let sourceUrl = '';
	let reactionUrl = '';
	let sourceName = 'Source';
	let reactionName = 'Reaction';

	// Parse query params for blob URLs
	if (browser) {
		const params = new URLSearchParams(window.location.search);
		sourceUrl = params.get('sourceUrl') ?? '';
		reactionUrl = params.get('reactionUrl') ?? '';
		sourceName = params.get('sourceName') ?? 'Source';
		reactionName = params.get('reactionName') ?? 'Reaction';
	}

	const videos: SessionVideo[] = $state([
		{
			id: 'source',
			role: 'source',
			title: sourceName,
			kind: 'file',
			url: sourceUrl,
			fileName: sourceName,
			currentTime: 0,
			duration: 0,
			volume: 1,
			muted: false,
			playbackRate: 1,
			offsetMs: 0
		},
		{
			id: 'reaction',
			role: 'reaction',
			title: reactionName,
			kind: 'file',
			url: reactionUrl,
			fileName: reactionName,
			currentTime: 0,
			duration: 0,
			volume: 1,
			muted: false,
			playbackRate: 1,
			offsetMs: 0
		}
	]);

	let isLinked = $state(true);
	let layoutType: LayoutType = $state('split');
	let masterId = $state('source');
	let offsetMs = $state(0);

	// Engine instance
	let engine: PlaybackEngine | null = null;

	// Video element refs
	let sourceEl = $state<HTMLVideoElement | null>(null);
	let reactionEl = $state<HTMLVideoElement | null>(null);
	let sourceAttached = $state(false);
	let reactionAttached = $state(false);

	// UI state
	let playing = $state(false);
	let clock = $state(0);
	let times: Record<string, number> = $state({ source: 0, reaction: 0 });
	let running: Record<string, boolean> = $state({});
	let buffering = $state(false);
	let failed: Record<string, boolean> = $state({});

	function getSession() {
		return {
			videos,
			masterId,
			isLinked,
			master: videos.find((v) => v.id === masterId) ?? null
		};
	}

	onMount(() => {
		engine = new PlaybackEngine(
			{
				onPlayingChange: (p) => {
					playing = p;
				},
				onClockChange: (c) => {
					clock = c;
				},
				onTimesChange: (t) => {
					times = t;
				},
				onRunningChange: (r) => {
					running = r;
				},
				onFailedChange: (f) => {
					failed = f;
				},
				onBufferingChange: (b) => {
					buffering = b;
				}
			},
			getSession
		);
		engine.bind();
	});

	onDestroy(() => {
		engine?.release();
		engine = null;
		if (sourceUrl) URL.revokeObjectURL(sourceUrl);
		if (reactionUrl) URL.revokeObjectURL(reactionUrl);
	});

	$effect(() => {
		if (!engine) return;
		if (sourceEl && !sourceAttached) {
			engine.attach('source', sourceEl);
			sourceAttached = true;
		}
		if (reactionEl && !reactionAttached) {
			engine.attach('reaction', reactionEl);
			reactionAttached = true;
		}
	});

	function togglePlay() {
		if (!engine) return;
		if (engine.playing) engine.pause();
		else void engine.play();
	}

	function seek(seconds: number) {
		if (!engine) return;
		engine.seek(clock + seconds);
	}

	function step(n: number) {
		if (!engine) return;
		void engine.step(n);
	}

	function toggleLink() {
		if (!engine) return;
		engine.setLinked(!isLinked);
		isLinked = !isLinked;
	}

	function setMaster(id: string) {
		masterId = id;
		if (engine) engine.refresh();
	}

	function nudgeOffset(deltaMs: number) {
		offsetMs += deltaMs;
		const v = videos.find((v) => v.id === 'reaction');
		if (v) v.offsetMs = offsetMs;
		if (engine) engine.refresh();
	}

	function formatTime(t: number): string {
		if (!Number.isFinite(t)) return '--:--';
		const m = Math.floor(t / 60);
		const s = Math.floor(t % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function durationFor(id: string): number {
		return videos.find((v) => v.id === id)?.duration ?? 0;
	}
</script>

<div class="flex flex-col h-full bg-black text-white overflow-hidden">
	<!-- Top bar -->
	<header class="h-12 border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
		<div class="flex items-center gap-4">
			<div class="font-bold text-yellow-400">RP</div>
			<div class="text-xs text-gray-400">
				{sourceName} ↔ {reactionName}
			</div>
		</div>

		<div class="flex items-center gap-2">
			<button
				onclick={togglePlay}
				class="px-3 py-1.5 rounded bg-yellow-400 text-black font-medium hover:bg-yellow-300"
			>
				{playing ? 'Pause' : 'Play'}
			</button>
			<button
				onclick={toggleLink}
				class="px-3 py-1.5 rounded border border-gray-700 hover:bg-gray-900 text-gray-300 {isLinked ? 'bg-gray-800 border-yellow-400 text-yellow-400' : ''}"
			>
				{isLinked ? 'Linked' : 'Unlinked'}
			</button>
			<button
				onclick={() => setMaster('source')}
				class="px-3 py-1.5 rounded border border-gray-700 hover:bg-gray-900 text-gray-300 {masterId === 'source' ? 'bg-yellow-400 text-black border-yellow-400' : ''}"
			>
				Source Master
			</button>
			<button
				onclick={() => setMaster('reaction')}
				class="px-3 py-1.5 rounded border border-gray-700 hover:bg-gray-900 text-gray-300 {masterId === 'reaction' ? 'bg-yellow-400 text-black border-yellow-400' : ''}"
			>
				Reaction Master
			</button>
		</div>
	</header>

	<!-- Main stage -->
	<main class="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
		{#if sourceUrl && reactionUrl}
			<div class="relative w-full h-full">
				<video
					bind:this={reactionEl}
					src={reactionUrl}
					class="absolute top-1/3 left-1/3 transform -translate-x-1/2 -translate-y-1/2 w-1/3 h-1/3 object-contain bg-black"
					playsinline
					muted={masterId === 'source'}
				></video>
				<video
					bind:this={sourceEl}
					src={sourceUrl}
					class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1/2 h-1/2 object-contain bg-black"
					playsinline
					muted={false}
				></video>
			</div>
		{:else}
			<div class="flex flex-col items-center justify-center text-gray-500">
				<p>Loading videos...</p>
			</div>
		{/if}
	</main>

	<!-- Transport -->
	<footer class="h-24 border-t border-gray-800 bg-[#0a0a0a] px-4 flex flex-col shrink-0">
		<div class="flex-1 overflow-x-auto pb-2">
			<div class="flex gap-4 min-w-full">
				{#each videos as video}
					<div class="flex-shrink-0 w-64">
						<div class="text-xs text-gray-500 mb-1 uppercase">{video.role}</div>
						<div class="flex items-end gap-1">
							<div class="flex-1 bg-gray-800 rounded-t relative">
								<div
									class="absolute bottom-0 left-0 h-full bg-yellow-400 rounded-t"
									style="width: {((times[video.id] ?? 0) / Math.max(durationFor(video.id), 1) * 100)}%"
								></div>
							</div>
							<div class="text-[10px] text-gray-400 flex justify-between">
								<span>{formatTime(times[video.id] ?? 0)}</span>
								<span>{formatTime(durationFor(video.id))}</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="flex items-center justify-between pt-2">
			<div class="flex items-center gap-3">
				<button
					onclick={() => seek(-5)}
					class="p-2 rounded hover:bg-gray-800 text-gray-300"
					title="Seek -5s"
				>
					⏮
				</button>
				<button
					onclick={() => step(-1)}
					disabled={!playing}
					class="p-2 rounded hover:bg-gray-800 text-gray-300"
					title="Step back 1 frame"
				>
					‹
				</button>
				<button
					onclick={() => step(1)}
					disabled={!playing}
					class="p-2 rounded hover:bg-gray-800 text-gray-300"
					title="Step forward 1 frame"
				>
					›
				</button>
				<button
					onclick={() => seek(5)}
					class="p-2 rounded hover:bg-gray-800 text-gray-300"
					title="Seek +5s"
				>
					⏭
				</button>
			</div>

			<div class="flex items-center gap-3">
				<div class="text-xs text-gray-400">Offset:</div>
				<button
					onclick={() => nudgeOffset(-100)}
					class="px-2 py-1 rounded hover:bg-gray-800 text-xs"
				>
					-100ms
				</button>
				<button
					onclick={() => nudgeOffset(-10)}
					class="px-2 py-1 rounded hover:bg-gray-800 text-xs"
				>
					-10ms
				</button>
				<span class="text-xs font-mono text-yellow-400">{offsetMs}ms</span>
				<button
					onclick={() => nudgeOffset(10)}
					class="px-2 py-1 rounded hover:bg-gray-800 text-xs"
				>
					+10ms
				</button>
				<button
					onclick={() => nudgeOffset(100)}
					class="px-2 py-1 rounded hover:bg-gray-800 text-xs"
				>
					+100ms
				</button>
			</div>
		</div>

		{#if buffering}
			<div class="text-[10px] text-yellow-400 mt-1">Buffering...</div>
		{/if}
	</footer>
</div>
