import type { Handle } from '@sveltejs/kit/hooks';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient(
		process.env.PUBLIC_SUPABASE_URL!,
		process.env.PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				setAll: (cookiesToSet) => {
					cookiesToSet.forEach(({ name, value, options }) => {
						event.cookies.set(name, value, options);
					});
				}
			}
		}
	);

	const {
		data: { session }
	} = await event.locals.supabase.auth.getSession();

	event.locals.session = session;
	event.locals.user = session?.user ?? null;

	return resolve(event, {
		filterSerializedResponseHeaders: (name: string) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};
