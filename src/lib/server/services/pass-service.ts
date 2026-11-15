/**
 * Session Pass Service — server-authoritative pass issuance.
 *
 * Free users: 6 passes per rolling 24 hours.
 * Pro users: unlimited passes.
 * A pass covers a reaction/source pair for 24 hours from issuance.
 * Within that pass: reload, resume, rewatch are free. Reopening the same pair
 * must not consume another pass.
 *
 * All allocation is atomic, idempotent, and returns a next-availability time.
 */

import { createSupabaseServiceClient } from '../supabase';
import type { SessionPass, PassType } from '$lib/types';
import { TIER_LIMITS, FREE_PASSES_PER_24H } from '$lib/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface PassResult {
	pass?: SessionPass | null;
	error?: string;
	nextAvailableAt?: number;
}

interface PassRow {
	id: string;
	user_id: string;
	reaction_identity: string;
	source_identity: string;
	pass_type: string;
	issued_at: string;
	expires_at: string;
	consumed_at: string | null;
	idempotency_key: string;
}

export class PassService {
	get #supabase() {
		return createSupabaseServiceClient();
	}

	/**
	 * Get or issue a pass for a reaction/source pair.
	 * Idempotent: reusing an unexpired pass does not consume a new one.
	 */
	async getOrIssuePass(
		userId: string,
		reactionIdentity: string,
		sourceIdentity: string,
		tier: 'free' | 'pro' = 'free'
	): Promise<PassResult> {
		const now = Date.now();
		const idempotencyKey = `${userId}:${reactionIdentity}:${sourceIdentity}`;

		// 1. Check for an existing unexpired pass for this pair
		const { data: existing } = await this.#supabase
			.from('session_passes')
			.select('*')
			.eq('idempotency_key', idempotencyKey)
			.gt('expires_at', new Date(now).toISOString())
			.is('consumed_at', null)
			.maybeSingle();

		if (existing) {
			return { pass: this.#mapPass(existing as PassRow) };
		}

		// 2. For free users, check pass quota in rolling 24h window
		if (tier === 'free') {
			const windowStart = new Date(now - MS_PER_DAY).toISOString();
			const { data: recentPasses, error: quotaError } = await this.#supabase
				.from('session_passes')
				.select('id, issued_at, expires_at, consumed_at')
				.eq('user_id', userId)
				.eq('pass_type', 'free')
				.gte('issued_at', windowStart)
				.order('issued_at', { ascending: false });

			if (quotaError) {
				return { error: 'Failed to check pass quota.' };
			}

			const passes = (recentPasses ?? []) as PassRow[];
			const active = passes.filter(
				(p) => !p.consumed_at && new Date(p.expires_at).getTime() > now
			);
			if (active.length >= FREE_PASSES_PER_24H) {
				const oldest = passes[passes.length - 1];
				const nextAvailableAt = oldest
					? new Date(oldest.issued_at).getTime() + MS_PER_DAY
					: now + MS_PER_DAY;
				return {
					pass: null,
					error: 'Daily pass limit reached.',
					nextAvailableAt
				};
			}
		}

		// 3. Issue a new pass
		const expiresAt = new Date(now + MS_PER_DAY).toISOString();
		const passType: PassType = tier === 'pro' ? 'pro' : 'free';

		const { data: newPass, error: insertError } = await this.#supabase
			.from('session_passes')
			.insert({
				user_id: userId,
				reaction_identity: reactionIdentity,
				source_identity: sourceIdentity,
				pass_type: passType,
				issued_at: new Date(now).toISOString(),
				expires_at: expiresAt,
				consumed_at: null,
				idempotency_key: idempotencyKey
			})
			.select()
			.single();

		if (insertError || !newPass) {
			return {
				pass: null,
				error: insertError?.message || 'Failed to issue pass.'
			};
		}

		return { pass: this.#mapPass(newPass as PassRow) };
	}

	/**
	 * Get remaining passes and next availability for a user.
	 */
	async getPassStatus(userId: string, tier: 'free' | 'pro' = 'free') {
		const now = Date.now();
		const windowStart = new Date(now - MS_PER_DAY).toISOString();

		if (tier === 'pro') {
			return { remaining: Infinity, limit: Infinity, nextAvailableAt: null };
		}

		const { data: passes, error } = await this.#supabase
			.from('session_passes')
			.select('id, issued_at, expires_at, consumed_at')
			.eq('user_id', userId)
			.eq('pass_type', 'free')
			.gte('issued_at', windowStart)
			.order('issued_at', { ascending: false });

		if (error) {
			return { remaining: 0, limit: FREE_PASSES_PER_24H, nextAvailableAt: now + MS_PER_DAY };
		}

		const rows = (passes ?? []) as PassRow[];
		const active = rows.filter(
			(p) => !p.consumed_at && new Date(p.expires_at).getTime() > now
		);
		const remaining = Math.max(0, FREE_PASSES_PER_24H - active.length);

		let nextAvailableAt: number | null = null;
		if (remaining === 0 && rows.length) {
			const oldest = rows[rows.length - 1];
			nextAvailableAt = new Date(oldest.issued_at).getTime() + MS_PER_DAY;
		}

		return { remaining, limit: FREE_PASSES_PER_24H, nextAvailableAt };
	}

	/**
	 * Mark a pass as consumed (when a session is actually started).
	 */
	async consumePass(passId: string): Promise<boolean> {
		const { error } = await this.#supabase
			.from('session_passes')
			.update({ consumed_at: new Date().toISOString() })
			.eq('id', passId)
			.is('consumed_at', null);

		return !error;
	}

	#mapPass(row: PassRow): SessionPass {
		return {
			id: row.id,
			userId: row.user_id,
			reactionIdentity: row.reaction_identity,
			sourceIdentity: row.source_identity,
			passType: row.pass_type as PassType,
			issuedAt: new Date(row.issued_at).getTime(),
			expiresAt: new Date(row.expires_at).getTime(),
			consumedAt: row.consumed_at ? new Date(row.consumed_at).getTime() : undefined,
			idempotencyKey: row.idempotency_key
		};
	}
}

export const passService = new PassService();
