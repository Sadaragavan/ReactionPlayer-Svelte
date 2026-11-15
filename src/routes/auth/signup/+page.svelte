<script lang="ts">
	let email = $state('');
	let password = $state('');
	let errorMsg = $state('');
	let successMsg = $state('');
	let loading = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';
		successMsg = '';
		loading = true;

		const formData = new FormData();
		formData.append('email', email);
		formData.append('password', password);

		const res = await fetch('?/signup', {
			method: 'POST',
			body: formData
		});

		const result = await res.json();
		loading = false;

		if (!res.ok) {
			errorMsg = result.error || 'Signup failed';
		} else {
			successMsg = result.success || 'Account created. Please sign in.';
			email = '';
			password = '';
		}
	}
</script>

<div class="min-h-screen flex items-center justify-center bg-black text-white">
	<div class="max-w-md w-full px-6">
		<div class="text-center mb-8">
			<h1 class="text-3xl font-bold tracking-tight">Reaction Player</h1>
			<p class="text-gray-400 mt-2">Create your account</p>
		</div>

		<form onsubmit={handleSubmit} class="space-y-4">
			<div>
				<label for="email" class="block text-sm font-medium text-gray-300 mb-1">
					Email
				</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					class="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded text-white focus:border-yellow-400 focus:outline-none"
					placeholder="you@example.com"
					required
				/>
			</div>

			<div>
				<label for="password" class="block text-sm font-medium text-gray-300 mb-1">
					Password
				</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					class="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded text-white focus:border-yellow-400 focus:outline-none"
					placeholder="••••••••"
					required
				/>
				<p class="text-xs text-gray-500 mt-1">At least 6 characters</p>
			</div>

			{#if errorMsg}
				<div class="text-red-400 text-sm">{errorMsg}</div>
			{/if}

			{#if successMsg}
				<div class="text-green-400 text-sm">{successMsg}</div>
			{/if}

			<button
				type="submit"
				disabled={loading}
				class="w-full px-4 py-2 bg-yellow-400 text-black font-medium rounded hover:bg-yellow-300 disabled:opacity-50"
			>
				{loading ? 'Creating account...' : 'Sign up'}
			</button>
		</form>

		<p class="text-center text-gray-400 text-sm mt-6">
			Already have an account?{' '}
			<a href="/auth/login" class="text-yellow-400 hover:underline">Sign in</a>
		</p>
	</div>
</div>
