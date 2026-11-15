import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { passService } from '$lib/server/services/pass-service';
import { entitlementService } from '$lib/server/services/entitlement-service';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const entitlements = await entitlementService.getEntitlements(user.id);
	const status = await passService.getPassStatus(
		user.id,
		entitlements.isPro ? 'pro' : 'free'
	);

	return json(status);
};
