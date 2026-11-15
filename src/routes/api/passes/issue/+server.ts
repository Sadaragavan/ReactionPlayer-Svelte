import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { passService } from '$lib/server/services/pass-service';
import { entitlementService } from '$lib/server/services/entitlement-service';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { reactionIdentity: string; sourceIdentity: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const { reactionIdentity, sourceIdentity } = body;
	if (!reactionIdentity || !sourceIdentity) {
		return json(
			{ error: 'reactionIdentity and sourceIdentity are required' },
			{ status: 400 }
		);
	}

	// Get user's tier from entitlements
	const entitlements = await entitlementService.getEntitlements(user.id);

	const result = await passService.getOrIssuePass(
		user.id,
		reactionIdentity,
		sourceIdentity,
		entitlements.isPro ? 'pro' : 'free'
	);

	if (result.error) {
		return json(
			{ error: result.error, nextAvailableAt: result.nextAvailableAt },
			{ status: 403 }
		);
	}

	return json({ pass: result.pass });
};
