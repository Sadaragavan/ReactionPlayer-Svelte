import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { passService } from '$lib/server/services/pass-service';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { passId: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const { passId } = body;
	if (!passId) {
		return json({ error: 'passId is required' }, { status: 400 });
	}

	const consumed = await passService.consumePass(passId);
	if (!consumed) {
		return json({ error: 'Pass not found or already consumed' }, { status: 404 });
	}

	return json({ success: true });
};
