/**
 * Timeline maths for linked playback. Pure functions, no DOM.
 *
 * The master clock `T` is the master video's own playhead (in seconds; its offset is 0).
 * Every other video v sits at `local(v) = T + offsetMs / 1000`. A video is
 * *active* while that local time lies inside [0, duration); outside it the
 * video is parked on its first or last frame while the clock keeps running.
 */

import type { ID, SessionVideo } from '$lib/types';

export type TimelineVideo = Pick<SessionVideo, 'id' | 'offsetMs'> & { duration: number };

export const localAt = (v: Pick<SessionVideo, 'offsetMs'>, master: number) =>
	master + v.offsetMs / 1000;

export const isActive = (v: TimelineVideo, master: number) => {
	const l = localAt(v, master);
	return l >= 0 && l < v.duration;
};

/** Where video `v` should be parked at master time `T` (clamped to its own length). */
export const clampLocal = (v: TimelineVideo, master: number) =>
	Math.min(Math.max(0, localAt(v, master)), Math.max(0, v.duration));

/**
 * The span of master time during which at least one video has footage.
 * Videos whose duration is still unknown are ignored.
 */
export function timelineRange(
	videos: TimelineVideo[]
): { start: number; end: number } {
	const known = videos.filter((v) => v.duration > 0);
	if (!known.length) return { start: 0, end: 0 };
	return {
		start: Math.min(...known.map((v) => -v.offsetMs / 1000)),
		end: Math.max(...known.map((v) => v.duration - v.offsetMs / 1000))
	};
}

/**
 * “Link” captures the alignment dialled in while unlinked: the master
 * keeps offset 0 and each other video gets the difference between its playhead
 * and the master's, so that nothing visibly jumps when playback becomes linked.
 */
export function offsetsFromLocals(
	masterId: ID,
	locals: Record<ID, number>,
	ids: ID[]
): Record<ID, number> {
	const base = locals[masterId] ?? 0;
	const out: Record<ID, number> = {};
	for (const id of ids) out[id] = id === masterId ? 0 : Math.round(((locals[id] ?? 0) - base) * 1000);
	return out;
}

/** Re-expresses all offsets relative to a new master (positions on screen do not change). */
export function rebaseOffsets(
	videos: Pick<SessionVideo, 'id' | 'offsetMs'>[],
	newMasterId: ID
): Record<ID, number> {
	const pivot = videos.find((v) => v.id === newMasterId)?.offsetMs ?? 0;
	const out: Record<ID, number> = {};
	for (const v of videos) out[v.id] = v.id === newMasterId ? 0 : Math.round(v.offsetMs - pivot);
	return out;
}

/* ── Drift correction ─────────────────────────────────────── */

export type Correction = { kind: 'none' } | { kind: 'seek' } | { kind: 'rate'; factor: number };

/**
 * Decides how to pull a follower back into line.
 *  - tiny drift        → leave it alone
 *  - moderate drift    → nudge playbackRate (inaudible, no frame skip)
 *  - large drift       → hard seek
 * `correcting` adds hysteresis: once we start nudging we keep going until the
 * drift is under half the tolerance, so the rate does not flutter around the limit.
 *
 * @param driftS   follower.currentTime − where it should be (positive = ahead)
 */
export function planCorrection(
	driftS: number,
	toleranceMs: number,
	hardSeekS: number,
	correcting: boolean
): Correction {
	const a = Math.abs(driftS);
	const tol = toleranceMs / 1000;
	if (a > hardSeekS) return { kind: 'seek' };
	if (a > tol || (correcting && a > tol / 2)) {
		const adjust = Math.min(0.08, Math.max(-0.08, driftS * 0.5));
		return { kind: 'rate', factor: 1 - adjust };
	}
	return { kind: 'none' };
}

/**
 * Frame `k` is on screen for `[k·d, (k+1)·d)`. The small epsilon keeps a time that
 * sits a hair *before* a frame boundary (floating-point noise from a seek) on
 * the frame it was aimed at; `frameCentre(k)` is the time that lands safely in
 * the middle of frame `k`, so a paused seek is deterministic.
 */
export const frameIndexAt = (time: number, frameDur: number) => Math.floor(time / frameDur + 0.02);
export const frameCentre = (k: number, frameDur: number) => (k + 0.5) * frameDur;
