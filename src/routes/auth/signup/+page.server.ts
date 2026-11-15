import type { Actions, ServerLoad } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { redirect } from '@sveltejs/kit';

export const load: ServerLoad = async ({ locals }) => {
	if (locals.session) {
		throw redirect(303, '/');
	}
};

export const actions: Actions = {
	signup: async ({ request, locals }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		if (!email || !password) {
			return { error: 'Email and password are required' };
		}

		const { error } = await locals.supabase.auth.signUp({
			email,
			password
		});

		if (error) {
			return { error: error.message };
		}

		return { success: 'Account created. Please check your email to confirm, then sign in.' };
	}
};
