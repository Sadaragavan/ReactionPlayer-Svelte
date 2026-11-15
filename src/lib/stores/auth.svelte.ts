/**
 * Client auth store — reactive session state.
 * Reads from Supabase auth and exposes sign-in/sign-out.
 */

import { createSupabaseBrowserClient } from '$lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

const supabase = createSupabaseBrowserClient();

export class AuthStore {
	user = $state<User | null>(null);
	session = $state<Session | null>(null);
	loading = $state(true);
	error = $state<string | null>(null);

	constructor() {
		// Listen for auth changes
		const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
			this.session = session ?? null;
			this.user = session?.user ?? null;
			this.loading = false;
		});

		// Initial session
		supabase.auth.getSession().then(({ data }) => {
			this.session = data.session ?? null;
			this.user = data.session?.user ?? null;
			this.loading = false;
		});
	}

	async signIn(email: string, password: string) {
		this.error = null;
		const { error } = await supabase.auth.signInWithPassword({ email, password });
		if (error) {
			this.error = error.message;
			return false;
		}
		return true;
	}

	async signUp(email: string, password: string) {
		this.error = null;
		const { error } = await supabase.auth.signUp({ email, password });
		if (error) {
			this.error = error.message;
			return false;
		}
		return true;
	}

	async signOut() {
		this.error = null;
		const { error } = await supabase.auth.signOut();
		if (error) {
			this.error = error.message;
			return false;
		}
		this.user = null;
		this.session = null;
		return true;
	}

	async resetPassword(email: string) {
		this.error = null;
		const { error } = await supabase.auth.resetPasswordForEmail(email, {
			redirectTo: `${import.meta.env.PUBLIC_APP_URL}/auth/reset-password`
		});
		if (error) {
			this.error = error.message;
			return false;
		}
		return true;
	}

	async updatePassword(password: string) {
		this.error = null;
		const { error } = await supabase.auth.updateUser({ password });
		if (error) {
			this.error = error.message;
			return false;
		}
		return true;
	}
}

export const auth = new AuthStore();
