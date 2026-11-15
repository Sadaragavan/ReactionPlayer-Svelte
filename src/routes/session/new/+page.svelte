<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { entitlements } from '$lib/stores/entitlements.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let sourceFile: File | null = $state(null);
	let reactionFile: File | null = $state(null);
	let loading = $state(false);
	let errorMsg = $state('');
	let passStatus: {
		remaining: number;
		limit: number;
		nextAvailableAt?: number;
	} | null = $state(null);

	onMount(() => {
		if (!auth.user) {
			void goto('/auth/login');
			return;
		}
		void entitlements.fetch();
		void fetchPassStatus();
	});

	async function fetchPassStatus() {
		const res = await fetch('/api/passes/status');
		if (res.ok) passStatus = await res.json();
	}

	async function handleCreate(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';
		loading = true;

		if (!sourceFile || !reactionFile) {
			errorMsg = 'Please select both source and reaction videos.';
			loading = false;
			return;
		}

		// Check pass availability
		if (passStatus && passStatus.remaining === 0 && passStatus.nextAvailableAt) {
			const waitMinutes = Math.ceil(
				(passStatus.nextAvailableAt - Date.now()) / 60000
			);
			errorMsg = `No passes available. Try again in ~${waitMinutes} minute(s).`;
			loading = false;
			return;
		}

		// Issue a pass for this pair
		const reactionIdentity = reactionFile.name;
		const sourceIdentity = sourceFile.name;

		const passRes = await fetch('/api/passes/issue', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ reactionIdentity, sourceIdentity })
		});

		if (!passRes.ok) {
			const err = await passRes.json();
			errorMsg = err.error || 'Failed to issue pass.';
			if (err.nextAvailableAt) {
				const waitMinutes = Math.ceil(
					(err.nextAvailableAt - Date.now()) / 60000
				);
				errorMsg += ` Try again in ~${waitMinutes} minute(s).`;
			}
			loading = false;
			return;
		}

		const passData = await passRes.json();

		// Consume the pass
		await fetch('/api/passes/consume', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ passId: passData.pass.id })
		});

		// Create blob URLs for the files
		const sourceBlobUrl = URL.createObjectURL(sourceFile);
		const reactionBlobUrl = URL.createObjectURL(reactionFile);

		// Navigate to session with video URLs as query params
		const params = new URLSearchParams({
			sourceUrl: sourceBlobUrl,
			reactionUrl: reactionBlobUrl,
			sourceName: sourceFile.name,
			reactionName: reactionFile.name
		});

		void goto(`/session?${params.toString()}`);
		loading = false;
	}
</script>

<div class="flex flex-col items-center justify-center h-full text-white p-8">
	<div class="max-w-lg w-full text-center">
		<h1 class="text-4xl font-bold tracking-tight mb-2">New Session</h1>
		<p class="text-gray-400 text-lg mb-8">
			Select your source and reaction videos to sync them.
		</p>

		{#if entitlements.entitlements}
			<div class="mb-6 p-4 border border-gray-800 rounded bg-[#0a0a0a] text-left text-sm">
				<div class="flex justify-between mb-2">
					<span class="text-gray-400">Passes remaining</span>
					<span class="font-mono text-yellow-400">
						{entitlements.entitlements.isPro ? '∞' : passStatus?.remaining ?? '—'}
					</span>
				</div>
				<div class="text-xs text-gray-500">
					{entitlements.entitlements.isPro
						? 'Unlimited passes (Pro)'
						: '6 free passes per 24 hours. Each pass covers one source/reaction pair.'}
				</div>
			</div>
		{/if}

		<form onsubmit={handleCreate} class="space-y-6">
			<div class="text-left">
				<label for="source-video" class="block text-sm font-medium text-gray-300 mb-2">
					Source Video
				</label>
				<div
					class="border border-gray-700 rounded p-4 hover:border-gray-600 transition-colors cursor-pointer"
				>
					{#if sourceFile}
						<div class="text-left">
							<div class="text-yellow-400 text-sm font-medium">
								📎 {sourceFile.name}
							</div>
							<div class="text-xs text-gray-500 mt-1">Click to change</div>
						</div>
					{:else}
						<div class="text-center">
							<div class="text-gray-400 text-sm">
								Click to select source video
							</div>
							<div class="text-xs text-gray-600 mt-1">
								MP4, WebM, MOV, etc.
							</div>
						</div>
					{/if}
					<input
						id="source-video"
						type="file"
						accept="video/*"
						class="hidden"
						onchange={(e) => {
							const file = (e.target as HTMLInputElement).files?.[0] ?? null;
							sourceFile = file;
						}}
					/>
				</div>
			</div>

			<div class="text-left">
				<label for="reaction-video" class="block text-sm font-medium text-gray-300 mb-2">
					Reaction Video
				</label>
				<div
					class="border border-gray-700 rounded p-4 hover:border-gray-600 transition-colors cursor-pointer"
				>
					{#if reactionFile}
						<div class="text-left">
							<div class="text-yellow-400 text-sm font-medium">
								📎 {reactionFile.name}
							</div>
							<div class="text-xs text-gray-500 mt-1">Click to change</div>
						</div>
					{:else}
						<div class="text-center">
							<div class="text-gray-400 text-sm">
								Click to select reaction video
							</div>
							<div class="text-xs text-gray-600 mt-1">
								MP4, WebM, MOV, etc.
							</div>
						</div>
					{/if}
					<input
						id="reaction-video"
						type="file"
						accept="video/*"
						class="hidden"
						onchange={(e) => {
							const file = (e.target as HTMLInputElement).files?.[0] ?? null;
							reactionFile = file;
						}}
					/>
				</div>
			</div>

			{#if errorMsg}
				<div class="text-red-400 text-sm text-center">{errorMsg}</div>
			{/if}

			<button
				type="submit"
				disabled={loading || !sourceFile || !reactionFile}
				class="w-full px-8 py-4 bg-yellow-400 text-black font-bold rounded hover:bg-yellow-300 disabled:opacity-50 text-xl"
			>
				{loading ? 'Creating session...' : 'Create Session'}
			</button>
		</form>

		<p class="text-center text-gray-500 text-xs mt-6">
			Videos are played as temporary blob URLs and are not stored on our servers.
		</p>
	</div>
</div>
