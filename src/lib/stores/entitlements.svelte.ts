/**
 * Client entitlements store — fetches server-authoritative entitlements.
 * Never trusts client-side tier; always validates via API.
 */

import type { AppEntitlements } from '$lib/types';

export class EntitlementsStore {
	entitlements = $state<AppEntitlements | null>(null);
	loading = $state(true);
	error = $state<string | null>(null);

	async fetch() {
		this.loading = true;
		this.error = null;
		try {
			const res = await fetch('/api/entitlements');
			if (!res.ok) throw new Error('Failed to load entitlements');
			this.entitlements = (await res.json()) as AppEntitlements;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			this.loading = false;
		}
	}
}

export const entitlements = new EntitlementsStore();
