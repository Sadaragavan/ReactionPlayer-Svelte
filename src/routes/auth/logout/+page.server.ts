import type { Actions } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { redirect } from '@sveltejs/kit';

export const actions: Actions = {
	default: async ({ locals }) => {
		await locals.supabase.auth.signOut();
		throw redirect(303, '/auth/login');
	}
};
