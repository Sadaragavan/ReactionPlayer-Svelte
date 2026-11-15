<script lang="ts">
	import fav from '#lib/assets/favicon.svg';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import type { LayoutData } from './$types';

	let { children } = $props();

	function handleLogout() {
		void auth.signOut().then(() => {
			void goto('/auth/login');
		});
	}
</script>

<svelte:head>
	<link rel="icon" href={fav} />
	<title>Reaction Player</title>
</svelte:head>

<div class="flex h-screen bg-black text-white overflow-hidden">
	<!-- Left dock (persistent, ~256px) -->
	<aside class="w-64 bg-[#0a0a0a] border-r border-gray-800 flex flex-col">
		<div class="h-12 flex items-center justify-center border-b border-gray-800">
			<span class="font-bold text-xl tracking-tight text-yellow-400">RP</span>
		</div>

		<nav class="flex-1 overflow-y-auto p-4 space-y-2">
			{#if auth.user}
				<button
					onclick={() => goto('/')}
					class="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-gray-800 text-gray-300"
				>
					<span>Continue</span>
				</button>
				<button
					onclick={() => goto('/session/new')}
					class="w-full flex items-center gap-3 px-3 py-2 text-left rounded bg-yellow-400 text-black hover:bg-yellow-300"
				>
					<span>New Session</span>
				</button>
				<button
					onclick={() => goto('/sessions')}
					class="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-gray-800 text-gray-300"
				>
					<span>Load Session</span>
				</button>
				<button
					onclick={() => goto('/presets')}
					class="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-gray-800 text-gray-300"
				>
					<span>Presets</span>
				</button>
				<button
					onclick={() => goto('/settings')}
					class="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-gray-800 text-gray-300"
				>
					<span>Settings</span>
				</button>
			{/if}
		</nav>

		<div class="p-4 border-t border-gray-800">
			<button
				onclick={handleLogout}
				class="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-gray-800 text-gray-400"
			>
				<span>Sign out</span>
			</button>
		</div>
	</aside>

	<!-- Main content -->
	<main class="flex-1 overflow-y-auto bg-black">
		{@render children()}
	</main>
</div>
