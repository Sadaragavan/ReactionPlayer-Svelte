import { createBrowserClient } from '@supabase/ssr';

let supabaseInstance: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
	if (!supabaseInstance) {
		supabaseInstance = createBrowserClient(
			import.meta.env.PUBLIC_SUPABASE_URL!,
			import.meta.env.PUBLIC_SUPABASE_ANON_KEY!
		);
	}
	return supabaseInstance;
}
