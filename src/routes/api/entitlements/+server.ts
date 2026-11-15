import type { RequestHandler } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { entitlementService } from '$lib/server/services/entitlement-service';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401
		});
	}

	const entitlements = await entitlementService.getEntitlements(user.id);
	return new Response(JSON.stringify(entitlements), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
};
