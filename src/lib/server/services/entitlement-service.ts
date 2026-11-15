/**
 * Entitlement Service — server-authoritative entitlement resolution.
 *
 * Determines a user's tier, limits, and trial status from entitlement grants
 * (Stripe, trial, gift, reward, admin). Client code never controls Pro status.
 */

import { createSupabaseServiceClient } from '../supabase';
import type { AppEntitlements, TierLimits } from '$lib/types';
import { TIER_LIMITS } from '$lib/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface EntitlementRow {
	id: string;
	user_id: string;
	tier: string;
	source: string;
	reference_id: string | null;
	starts_at: string;
	ends_at: string | null;
}

export class EntitlementService {
	get #supabase() {
		return createSupabaseServiceClient();
	}

	/**
	 * Resolve effective entitlements for a user.
	 * Checks active entitlement grants (non-expired) and falls back to free.
	 */
	async getEntitlements(userId: string): Promise<AppEntitlements> {
		const now = Date.now();

		// Get the user's profile tier as a baseline
		const { data: profile } = await this.#supabase
			.from('profiles')
			.select('user_tier')
			.eq('id', userId)
			.maybeSingle();

		const baseTier: 'free' | 'pro' =
			(profile?.user_tier as 'free' | 'pro') ?? 'free';

		// Check for active pro entitlement grants
		const { data: grants } = await this.#supabase
			.from('entitlement_grants')
			.select('tier, starts_at, ends_at, source')
			.eq('user_id', userId)
			.eq('tier', 'pro')
			.order('starts_at', { ascending: false });

		const rows = (grants ?? []) as EntitlementRow[];
		const activeProGrant = rows.find(
			(g) =>
				new Date(g.starts_at).getTime() <= now &&
				(!g.ends_at || new Date(g.ends_at).getTime() > now)
		);

		const isPro = baseTier === 'pro' || !!activeProGrant;
		const tier: 'free' | 'pro' = isPro ? 'pro' : 'free';
		const limits: TierLimits = TIER_LIMITS[tier];

		// Trial status
		const trialGrant = rows.find(
			(g) =>
				g.source === 'trial' &&
				new Date(g.starts_at).getTime() <= now &&
				(!g.ends_at || new Date(g.ends_at).getTime() > now)
		);

		const trialActive = !!trialGrant;

		// Check if user has ever used a trial
		const { data: trialHistory } = await this.#supabase
			.from('entitlement_grants')
			.select('id')
			.eq('user_id', userId)
			.eq('source', 'trial')
			.maybeSingle();

		const trialUsed = !!trialHistory;
		const trialAvailable = !trialUsed && !trialActive && tier === 'free';

		return {
			tier,
			isPro,
			limits,
			trialAvailable,
			trialUsed
		};
	}

	/**
	 * Grant an entitlement to a user (server-only, e.g. from Stripe webhook).
	 */
	async grantEntitlement(args: {
		userId: string;
		tier: 'free' | 'pro';
		source: 'stripe' | 'trial' | 'gift' | 'reward' | 'admin';
		referenceId?: string;
		days?: number;
	}): Promise<void> {
		const now = Date.now();
		const endsAt = args.days
			? new Date(now + args.days * MS_PER_DAY).toISOString()
			: null;

		await this.#supabase.from('entitlement_grants').insert({
			user_id: args.userId,
			tier: args.tier,
			source: args.source,
			reference_id: args.referenceId ?? null,
			starts_at: new Date(now).toISOString(),
			ends_at: endsAt
		});

		// Also update profile tier if this is a persistent pro grant
		if (args.tier === 'pro' && args.source === 'stripe' && !args.days) {
			await this.#supabase
				.from('profiles')
				.update({ user_tier: 'pro' })
				.eq('id', args.userId);
		}
	}

	/**
	 * Revoke an entitlement grant (admin action).
	 */
	async revokeEntitlement(grantId: string): Promise<void> {
		await this.#supabase
			.from('entitlement_grants')
			.update({ ends_at: new Date().toISOString() })
			.eq('id', grantId);
	}
}

export const entitlementService = new EntitlementService();
