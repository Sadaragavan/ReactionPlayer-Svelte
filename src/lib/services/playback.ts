/**
 * PlaybackEngine — the shared clock, the transport and the drift correction.
 *
 * Linked mode
 *   One master clock `T` (the master video's playhead, in seconds; negative when
 *   another video starts first). Video v plays at `T + offsetMs/1000`. While the
 *   master has footage it *is* the clock; outside its range a virtual clock
 *   (rAF delta time) keeps the timeline moving so the other videos can play on.
 *   Each follower is checked against the clock on every frame the master
 *   presents (requestVideoFrameCallback) and falls back to a rAF check when the
 *   master is parked: small drift is absorbed by a ±8 % playbackRate nudge
 *   (inaudible, no skipped frame), large drift by a hard seek.
 *
 *   Videos need not be the same length. The timeline is the union of all footage
 *   (`range`); a video outside its own footage waits on its first or last frame,
 *   playback ends only when every video has ended, a single step follows the
 *   video that is on screen, and while the master has no footage its sound is
 *   lent to the first video that does.
 *
 * Unlinked mode
 *   Every element plays on its own; the HUD scrubs and steps them one by one so
 *   offsets can be dialled in by eye. Linking then captures those playheads.
 */

import { FALLBACK_FPS, HARD_SEEK_THRESHOLD_S } from '$lib/types';
import {
	clampLocal,
	frameCentre,
	frameIndexAt,
	isActive,
	planCorrection,
	timelineRange
} from '$lib/services/timeline';
import { type FrameMeta, Track } from '$lib/services/track';
import type { ID, SessionVideo } from '$lib/types';

const noop = () => {};
const RATE_MIN = 0.0625;
const RATE_MAX = 16;

export interface EngineEvents {
	onPlayingChange(playing: boolean): void;
	onClockChange(clock: number): void;
	onTimesChange(times: Record<ID, number>): void;
	onRunningChange(running: Record<ID, boolean>): void;
	onFailedChange(failed: Record<ID, boolean>): void;
	onBufferingChange(buffering: boolean): void;
}

interface SessionLike {
	videos: SessionVideo[];
	masterId: ID;
	isLinked: boolean;
	master?: SessionVideo | null;
}

export class PlaybackEngine {
	/** Linked: the shared clock is running. */
	playing = false;
	/** Linked clock in master-local seconds. */
	clock = 0;
	/** Each video's own playhead (drives the unlinked scrubbers). */
	times: Record<ID, number> = {};
	/** Whether each element is playing right now. */
	running: Record<ID, boolean> = {};
	/** Elements the browser could not decode. */
	failed: Record<ID, boolean> = {};
	/** The master is waiting for data. */
	buffering = false;

	#tracks = new Map<ID, Track>();
	#raf = 0;
	#lastNow = 0;
	#lastSync = 0;
	#thumbTimer: ReturnType<typeof setTimeout> | null = null;
	/** Linked: the video heard in place of a master that has no footage right now. */
	#lent: ID | null = null;

	#events: EngineEvents;
	/** Session reference (caller-provided, read-only). */
	#getSession: () => SessionLike | null;

	constructor(events: EngineEvents, getSession: () => SessionLike | null) {
		this.#events = events;
		this.#getSession = getSession;
	}

	/* ── read side ── */

	get range() {
		const s = this.#getSession();
		if (!s) return { start: 0, end: 0 };
		return timelineRange(s.videos);
	}

	get anyRunning(): boolean {
		const s = this.#getSession();
		if (!s) return false;
		return s.isLinked ? this.playing : Object.values(this.running).some(Boolean);
	}

	element(id: ID): HTMLVideoElement | null {
		return this.#tracks.get(id)?.el ?? null;
	}

	frameDur(id: ID): number {
		return this.#tracks.get(id)?.frameDur ?? 1 / FALLBACK_FPS;
	}

	/* ── lifecycle ── */

	/** Call once when a session is shown, before its <video> elements mount. */
	bind(): void {
		const s = this.#getSession();
		if (!s) return;
		cancelAnimationFrame(this.#raf);
		this.#raf = 0;
		this.playing = false;
		this.running = {};
		this.failed = {};
		this.buffering = false;
		this.#lent = null;
		this.times = Object.fromEntries(s.videos.map((v) => [v.id, v.currentTime]));
		this.#events.onTimesChange(this.times);
	}

	/** Registers a <video> for a session video id; returns the cleanup. */
	attach(id: ID, el: HTMLVideoElement): () => void {
		const track = new Track(id, el as any, {
			onMeta: (t: Track) => this.#onMeta(t),
			onFrame: (t: Track, m: FrameMeta) => this.#onFrame(t, m),
			onState: (t: Track) => this.#onState(t)
		});
		this.#tracks.set(id, track);
		el.preservesPitch = true;
		el.disablePictureInPicture = true;
		if (el.readyState >= 1) this.#onMeta(track);
		return () => {
			track.destroy();
			this.#tracks.delete(id);
			delete this.running[id];
			delete this.times[id];
		};
	}

	/** Pauses everything and stores the position. Call when leaving the session page. */
	release(): void {
		this.pause();
		cancelAnimationFrame(this.#raf);
		this.#raf = 0;
		if (this.#thumbTimer) clearTimeout(this.#thumbTimer);
	}

	/* ── transport ── */

	async play(): Promise<void> {
		const s = this.#getSession();
		if (!s) return;
		if (s.isLinked) {
			const r = this.range;
			if (r.end > r.start && this.clock >= r.end - 0.05) this.clock = r.start;
			this.playing = true;
			this.#lastNow = performance.now();
			this.#syncLinked(true);
		} else {
			const all = [...this.#tracks.values()];
			const live = all.filter((t) => !t.el.ended);
			for (const t of live.length ? live : all) void t.el.play().catch(noop);
		}
		this.#loop();
		this.#events.onPlayingChange(this.playing);
	}

	pause(): void {
		const s = this.#getSession();
		if (!s) return;
		this.playing = false;
		for (const t of this.#tracks.values()) if (!t.el.paused) t.el.pause();
		this.#updateLent();
		this.#settleClock();
		this.#syncRunning();
		this.#events.onPlayingChange(this.playing);
		this.#events.onTimesChange(this.times);
	}

	/**
	 * The clock is sampled once per animation frame, so at the instant of a pause it
	 * can trail the picture by up to a frame. Re-reading the element makes the very
	 * first single-step after a pause move by exactly one frame.
	 */
	#settleClock(): void {
		const ref = this.#reference();
		const el = ref ? this.#tracks.get(ref.id)?.el : null;
		const s = this.#getSession();
		if (
			ref &&
			el &&
			s?.isLinked &&
			el.readyState >= 2 &&
			!el.seeking &&
			isActive(ref, this.clock)
		) {
			this.clock = el.currentTime - ref.offsetMs / 1000;
			this.#events.onClockChange(this.clock);
		}
	}

	/** The video whose picture and frame grid a single step follows: the master while it has footage, else the first video that does. */
	#reference(): SessionVideo | null {
		const s = this.#getSession();
		const master = s?.videos.find((v) => v.id === s.masterId);
		if (!s || !master) return null;
		if (isActive(master, this.clock)) return master;
		return (s.videos.find((v) => isActive(v, this.clock)) ?? master) || null;
	}

	/** Unlinked: play or pause a single video. */
	toggleVideo(id: ID): void {
		const el = this.element(id);
		if (!el) return;
		if (el.paused) void el.play().catch(noop);
		else el.pause();
	}

	/** Linked: move the shared clock. */
	seek(t: number): void {
		const r = this.range;
		this.clock = Math.min(Math.max(t, r.start), Math.max(r.start, r.end));
		this.#syncLinked(true);
		this.#events.onClockChange(this.clock);
		this.#events.onTimesChange(this.times);
	}

	/** Unlinked: move one video. */
	seekVideo(id: ID, t: number): void {
		const el = this.element(id);
		if (!el) return;
		el.currentTime = Math.min(Math.max(t, 0), Math.max(0, (el.duration || 0) - 0.001));
		this.times[id] = el.currentTime;
		this.#events.onTimesChange(this.times);
	}

	/** ← / → : jump by seconds while playing, by a frame while paused. */
	skip(seconds: number): void {
		const s = this.#getSession();
		if (!s) return;
		if (!this.anyRunning) return void this.step(Math.sign(seconds));
		if (s.isLinked) return this.seek(this.clock + seconds);
		for (const v of s.videos) {
			this.seekVideo(v.id, (this.element(v.id)?.currentTime ?? 0) + seconds);
		}
	}

	/** Single-frame step. Linked: the shared clock; unlinked: `id`, or every video. */
	async step(n: number, id?: ID): Promise<void> {
		const s = this.#getSession();
		if (!s || !n) return;
		this.pause();
		if (id || !s.isLinked) {
			for (const v of id ? [{ id }] : s.videos) {
				const tr = this.#tracks.get(v.id);
				if (!tr) continue;
				await tr.measure();
				const k = frameIndexAt(tr.el.currentTime, tr.frameDur);
				this.seekVideo(v.id, frameCentre(k + n, tr.frameDur));
			}
			return;
		}
		// Linked: one frame of the video that is on screen, on that video's own frame grid.
		const ref = this.#reference();
		const tr = ref ? this.#tracks.get(ref.id) : undefined;
		if (ref && tr) {
			await tr.measure();
		}
		const fd = tr?.frameDur ?? 1 / FALLBACK_FPS;
		const off = (ref?.offsetMs ?? 0) / 1000;
		this.seek(frameCentre(frameIndexAt(this.clock + off, fd) + n, fd) - off);
	}

	/* ── linking and offsets ── */

	setLinked(on: boolean): void {
		const s = this.#getSession();
		if (!s || s.isLinked === on) return;
		const wasRunning = this.anyRunning;
		if (on) {
			const locals = this.#locals();
			this.clock = locals[s.masterId] ?? this.clock;
			this.playing = wasRunning;
			this.#lastNow = performance.now();
			this.#syncLinked(true);
			this.#loop();
		} else {
			this.playing = false;
			this.#updateLent();
			this.#syncRunning();
		}
		this.#events.onPlayingChange(this.playing);
		this.#events.onClockChange(this.clock);
	}

	/** Re-places every element after something it depends on changed (an offset, the master). */
	refresh(): void {
		if (this.#getSession()?.isLinked) this.#syncLinked(true);
		this.#events.onTimesChange(this.times);
	}

	/**
	 * Pushes volume, mute and speed from the caller onto the elements.
	 */
	applyProps(
		getVolume: (id: ID) => number,
		getMuted: (id: ID) => boolean,
		getRate: (id: ID) => number
	): void {
		const s = this.#getSession();
		if (!s) return;
		const master = s.videos.find((v) => v.id === s.masterId);
		const heard = { muted: master?.muted ?? false, volume: master?.volume ?? 1 };
		for (const v of s.videos) {
			const tr = this.#tracks.get(v.id);
			if (!tr || tr.probing) continue;
			const el = tr.el;
			const lent = v.id === this.#lent;
			const volume = lent ? heard.volume : getVolume(v.id);
			const muted = lent ? heard.muted : getMuted(v.id);
			if (el.volume !== volume) el.volume = volume;
			if (el.muted !== muted) el.muted = muted;
			if (!tr.correcting && el.playbackRate !== getRate(v.id)) {
				el.playbackRate = Math.min(Math.max(getRate(v.id), RATE_MIN), RATE_MAX);
			}
		}
	}

	/* ── internals: events ── */

	#onMeta(t: Track): void {
		const { el, id } = t;
		delete this.failed[id];
		const s = this.#getSession();
		const v = s?.videos.find((x) => x.id === id);
		if (v && Number.isFinite(el.duration)) {
			v.duration = el.duration;
		}
		if (v && !this.running[id] && !this.playing) {
			const at = s?.isLinked
				? Math.min(Math.max(0, this.clock + v.offsetMs / 1000), Math.max(0, v.duration))
				: v.currentTime;
			if (Math.abs(el.currentTime - at) > 0.004) el.currentTime = at;
		}
		this.#events.onTimesChange(this.times);
	}

	#onFrame(t: Track, _meta: FrameMeta): void {
		const s = this.#getSession();
		// Frame-locked sync: the instant the master shows a new picture, check the followers.
		if (s?.isLinked && this.playing && t.id === s.masterId && !t.el.paused) {
			this.#lastSync = performance.now();
			this.clock = t.el.currentTime;
			this.#syncLinked(false);
			this.#events.onClockChange(this.clock);
		}
	}

	#onState(t: Track): void {
		const { el, id } = t;
		this.running[id] = !el.paused && !el.ended;
		if (el.error) this.failed[id] = true;
		const s = this.#getSession();
		if (id === s?.masterId) {
			this.buffering = !el.paused && el.readyState < 3 && !el.seeking;
			this.#events.onBufferingChange(this.buffering);
		}
		if (this.anyRunning) this.#loop();
		this.#events.onRunningChange(this.running);
		this.#events.onTimesChange(this.times);
	}

	#syncRunning(): void {
		for (const [id, t] of this.#tracks) this.running[id] = !t.el.paused && !t.el.ended;
		this.#events.onRunningChange(this.running);
	}

	/* ── internals: the loop ── */

	#loop(): void {
		if (this.#raf) return;
		this.#lastNow = performance.now();
		const frame = (now: number) => {
			this.#raf = 0;
			const s = this.#getSession();
			if (!s) return;
			if (s.isLinked && this.playing) {
				this.#advance(now);
				if (this.playing && now - this.#lastSync > 12) this.#syncLinked(false);
			}
			this.#events.onTimesChange(this.times);
			if (this.anyRunning) this.#raf = requestAnimationFrame(frame);
		};
		this.#raf = requestAnimationFrame(frame);
	}

	/** Moves the clock: read from the master while it has footage, else advance a virtual one. */
	#advance(now: number): void {
		const s = this.#getSession()!;
		const dt = Math.min(Math.max((now - this.#lastNow) / 1000, 0), 0.25);
		this.#lastNow = now;
		const m = s.videos.find((v) => v.id === s.masterId);
		const me = this.#tracks.get(s.masterId)?.el;
		if (m && me && isActive(m, this.clock) && !me.paused && !me.seeking && me.readyState >= 2) {
			this.clock = me.currentTime;
		} else {
			this.clock += dt * (m?.playbackRate ?? 1);
		}

		const r = this.range;
		if (r.end > r.start && this.clock >= r.end - 0.001) {
			this.playing = false;
			this.clock = r.end;
			this.#syncLinked(true);
			this.#events.onPlayingChange(this.playing);
			this.#events.onClockChange(this.clock);
		}
	}

	/**
	 * Puts every element where the clock says it should be.
	 * `force` (user seek, play, link) hard-places everything; otherwise only drift is corrected.
	 */
	#syncLinked(force: boolean): void {
		const s = this.#getSession();
		if (!s?.isLinked) return;
		const tolerance = 20; // ms, default sync tolerance
		this.#updateLent();
		for (const v of s.videos) {
			const tr = this.#tracks.get(v.id);
			if (!tr) continue;
			const el = tr.el;
			const target = Math.min(
				Math.max(0, this.clock + v.offsetMs / 1000),
				Math.max(0, v.duration)
			);

			// Not playing, or this video has no footage at this moment: park it on the right picture.
			if (!this.playing || !isActive(v, this.clock)) {
				if (!el.paused) el.pause();
				tr.correcting = false;
				if (el.playbackRate !== v.playbackRate) {
					el.playbackRate = Math.min(Math.max(v.playbackRate, RATE_MIN), RATE_MAX);
				}
				if (force || Math.abs(el.currentTime - target) > 0.004) el.currentTime = target;
				continue;
			}

			// Playing with footage: start it, or leave the master alone (it is the clock).
			if (force || el.paused) {
				el.currentTime = target;
				el.playbackRate = Math.min(Math.max(v.playbackRate, RATE_MIN), RATE_MAX);
				tr.correcting = false;
				void el.play().catch(noop);
				continue;
			}
			if (v.id === s.masterId) continue;

			const plan = planCorrection(
				el.currentTime - target,
				tolerance,
				HARD_SEEK_THRESHOLD_S,
				tr.correcting
			);
			if (plan.kind === 'seek') {
				el.currentTime = target + 0.06 * v.playbackRate; // lead covers the seek latency
				el.playbackRate = Math.min(Math.max(v.playbackRate, RATE_MIN), RATE_MAX);
				tr.correcting = false;
			} else if (plan.kind === 'rate') {
				el.playbackRate = Math.min(
					Math.max(v.playbackRate * plan.factor, RATE_MIN),
					RATE_MAX
				);
				tr.correcting = true;
			} else if (tr.correcting) {
				el.playbackRate = Math.min(Math.max(v.playbackRate, RATE_MIN), RATE_MAX);
				tr.correcting = false;
			}
		}
		this.#events.onTimesChange(this.times);
	}

	/** The video whose picture and frame grid a single step follows: the master while it has footage, else the first video that does. */
	#lendTarget(): ID | null {
		const s = this.#getSession();
		const master = s?.videos.find((v) => v.id === s.masterId);
		if (!s?.isLinked || !this.playing || !master) return null;
		if (isActive(master, this.clock)) return null;
		const active = s.videos.filter(
			(v) => v.id !== master.id && isActive(v, this.clock)
		);
		if (active.some((v) => !v.muted && v.volume > 0)) return null;
		return active[0]?.id ?? null;
	}

	#updateLent(): void {
		const next = this.#lendTarget();
		if (next === this.#lent) return;
		this.#lent = next;
	}

	#locals(): Record<ID, number> {
		const out: Record<ID, number> = {};
		for (const [id, tr] of this.#tracks) out[id] = tr.el.currentTime;
		return out;
	}
}
