/**
 * One <video> element wrapped for the playback engine.
 *
 * It listens for lifecycle events and uses requestVideoFrameCallback to learn
 * the clip's real frame rate: every presented frame reports its media
 * timestamp, so the gap between two consecutive frames *is* the frame duration.
 * Frame stepping and the paused-seek snap depend on that number being right.
 */

import { FALLBACK_FPS } from '$lib/types';
import type { ID } from '$lib/types';

export interface FrameMeta {
	mediaTime: number;
	presentedFrames: number;
}

type FrameVideo = HTMLVideoElement & {
	requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
	cancelVideoFrameCallback?: (handle: number) => void;
};

export interface TrackEvents {
	/** loadedmetadata / durationchange: dimensions and duration are now known. */
	onMeta(track: Track): void;
	/** A new picture reached the screen. */
	onFrame(track: Track, meta: FrameMeta): void;
	/** play, pause, ended, seeked, waiting, playing, error. */
	onState(track: Track): void;
}

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
/** 29.9702 → 29.97, but a genuine 27.5 stays 27.5. */
const snapFps = (f: number) => COMMON_FPS.find((c) => Math.abs(c - f) / c < 0.004) ?? Math.round(f * 100) / 100;

export class Track {
	fps = FALLBACK_FPS;
	/** True once real frames have been timed (until then `fps` is a guess). */
	measured = false;
	/** Hysteresis flag for drift correction (see planCorrection). */
	correcting = false;
	/** True while `measure()` is briefly playing the clip; the engine ignores its events. */
	probing = false;
	/** Set when a remote clip refused CORS and was reloaded without it: pixels cannot be read back. */
	tainted = false;

	#samples: number[] = [];
	#last: FrameMeta | null = null;
	#handle: number | null = null;
	#off: (() => void)[] = [];

	constructor(
		readonly id: ID,
		readonly el: FrameVideo,
		private readonly events: TrackEvents
	) {
		const on = (type: string, fn: () => void) => {
			el.addEventListener(type, fn);
			this.#off.push(() => el.removeEventListener(type, fn));
		};
		on('loadedmetadata', () => events.onMeta(this));
		on('durationchange', () => events.onMeta(this));
		for (const type of ['play', 'pause', 'ended', 'seeked', 'waiting', 'playing', 'error']) {
			on(type, () => {
				if (!this.probing) events.onState(this);
			});
		}
		this.#watch();
	}

	get frameDur(): number {
		return 1 / this.fps;
	}

	#watch(): void {
		const el = this.el;
		if (typeof el.requestVideoFrameCallback !== 'function') return;
		const cb = (_now: number, meta: FrameMeta) => {
			this.#sample(meta);
			this.events.onFrame(this, meta);
			this.#handle = el.requestVideoFrameCallback!(cb);
		};
		this.#handle = el.requestVideoFrameCallback(cb);
	}

	/** Only consecutive frames of a *playing* clip count; scrub seeks would skew the median. */
	#sample(meta: FrameMeta): void {
		const prev = this.#last;
		this.#last = meta;
		if (!prev || this.el.paused) return;
		const dFrames = meta.presentedFrames - prev.presentedFrames;
		const dTime = meta.mediaTime - prev.mediaTime;
		if (dFrames !== 1 || dTime <= 0.004 || dTime >= 0.25) return;
		this.#samples.push(dTime);
		if (this.#samples.length > 15) this.#samples.shift();
		if (this.#samples.length < 5) return;
		const sorted = [...this.#samples].sort((a, b) => a - b);
		this.fps = snapFps(1 / sorted[sorted.length >> 1]);
		this.measured = true;
	}

	/**
	 * Plays the clip silently for a moment to time its frames, then puts it back.
	 * Used the first time someone single-steps a clip that has never played.
	 */
	async measure(): Promise<number> {
		const el = this.el;
		if (this.measured || typeof el.requestVideoFrameCallback !== 'function' || el.readyState < 2)
			return this.fps;
		const muted = el.muted;
		const t0 = el.currentTime;
		this.probing = true;
		el.muted = true;
		try {
			await el.play();
			const started = performance.now();
			while (!this.measured && performance.now() - started < 1500) {
				await new Promise((r) => setTimeout(r, 30));
			}
		} catch {
			/* autoplay refused: keep the fallback */
		} finally {
			el.pause();
			el.currentTime = t0;
			el.muted = muted;
			this.probing = false;
		}
		return this.fps;
	}

	destroy(): void {
		if (this.#handle !== null) this.el.cancelVideoFrameCallback?.(this.#handle);
		for (const off of this.#off) off();
		this.#off = [];
	}

	element(): HTMLVideoElement | null {
		return this.el;
	}
}
