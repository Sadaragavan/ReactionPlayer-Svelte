<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		if (!auth.user) {
			void goto('/auth/login');
		}
	});

	function newSession() {
		void goto('/session/new');
	}
</script>

<div class="flex flex-col items-center justify-center h-full text-white p-8">
	<div class="max-w-2xl w-full text-center">
		<h1 class="text-5xl font-bold tracking-tight mb-2">Reaction Player</h1>
		<p class="text-gray-400 text-lg mb-12">
			Synchronized reaction video playback. Frame-accurate. Browser-native.
		</p>

		<div class="space-y-4">
			<button
				onclick={newSession}
				class="w-full px-8 py-4 bg-yellow-400 text-black font-bold rounded hover:bg-yellow-300 text-xl"
			>
				New Session
			</button>

			<button
				onclick={() => goto('/sessions')}
				class="w-full px-8 py-4 border border-gray-700 rounded hover:bg-gray-900 text-gray-300 text-xl"
			>
				Load Session
			</button>

			<button
				onclick={() => goto('/presets')}
				class="w-full px-8 py-4 border border-gray-700 rounded hover:bg-gray-900 text-gray-300 text-xl"
			>
				Presets
			</button>

			<button
				onclick={() => goto('/settings')}
				class="w-full px-8 py-4 border border-gray-700 rounded hover:bg-gray-900 text-gray-300 text-xl"
			>
				Settings
			</button>
		</div>

		<div class="mt-12 p-6 border border-gray-800 rounded bg-[#0a0a0a] text-left">
			<h2 class="font-semibold mb-4">Free Plan</h2>
			<ul class="text-sm text-gray-400 space-y-2">
				<li>• 2 videos per session</li>
				<li>• 6 session passes per 24 hours</li>
				<li>• Local save & resume</li>
				<li>• Linked & unlinked playback</li>
			</ul>
		</div>
	</div>
</div>
