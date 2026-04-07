<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Project Nornyx</title>
	<meta name="description" content="Project Nornyx — AI-guided 5e adventures in procedurally generated worlds. Play solo or with friends, guided by an intelligent narrator in a living fantasy world." />
</svelte:head>

<section class="hero-section">
	<div class="hero-inner">
		<div class="hero-content">
			<p class="hero-eyebrow">AI-Guided 5e Adventures</p>
			<h1 class="hero-title">Your World.<br />Your Story.</h1>
			<p class="hero-description">
				Step into a procedurally generated fantasy world and forge your own path.
				Choose your way through AI-driven narratives grounded in rich world data —
				solo or with friends.
			</p>

			<div class="hero-actions">
				{#if data.user}
					<a href="/adventures" class="btn btn-primary btn-lg">Your Adventures</a>
				{:else}
					<a href="/auth/login" class="btn btn-primary btn-lg">Begin Your Adventure</a>
				{/if}
			</div>
		</div>
	</div>

	<div class="hero-visual">
		<div class="orb orb-1"></div>
		<div class="orb orb-2"></div>
		<div class="orb orb-3"></div>
	</div>
</section>

<div class="landing">
	<section class="features-section">
		<div class="feature-grid">
			<div class="feature-card">
				<span class="feature-icon">🌍</span>
				<h3>Living Worlds</h3>
				<p>Procedurally generated continents with cultures, religions, trade routes, and political intrigue — all grounded in real map data.</p>
			</div>
			<div class="feature-card">
				<span class="feature-icon">🎭</span>
				<h3>AI Narrator</h3>
				<p>An intelligent game master that responds to your choices, weaving narrative threads through the world's history and geography.</p>
			</div>
			<div class="feature-card">
				<span class="feature-icon">⚔️</span>
				<h3>5e Mechanics</h3>
				<p>Built on the foundation of 5th Edition rules — character creation, combat, skill checks, and progression you already know.</p>
			</div>
			<div class="feature-card">
				<span class="feature-icon">👥</span>
				<h3>Solo or Party</h3>
				<p>Adventure alone or gather your friends. Create a lobby, share a link, and embark together on a collaborative journey.</p>
			</div>
		</div>
	</section>
</div>

<style>
	.landing {
		width: min(1200px, calc(100vw - 32px));
		margin: 0 auto;
	}

	/* ─── Hero ────────────────────────────────────── */
	.hero-section {
		position: relative;
		display: flex;
		align-items: center;
		min-height: 70vh;
		padding: 4rem 0 6rem;
		overflow: hidden;
	}

	.hero-section::after {
		content: '';
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 120px;
		background: linear-gradient(to bottom, transparent, var(--bg));
		z-index: 2;
		pointer-events: none;
	}

	.hero-inner {
		width: min(1200px, calc(100vw - 32px));
		margin: 0 auto;
		position: relative;
		z-index: 1;
		width: 100%;
		max-width: 1200px;
		padding: 0 1rem;
	}

	.hero-content {
		position: relative;
		z-index: 1;
		max-width: 640px;
		padding-left: 0.5rem;
	}

	.hero-eyebrow {
		color: var(--accent);
		font-size: 0.9rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		margin: 0 0 1rem;
	}

	.hero-title {
		font-family: var(--font-display);
		font-size: clamp(2.5rem, 6vw, 4.5rem);
		font-weight: 800;
		line-height: 1.15;
		margin: 0 0 1.5rem;
		padding-bottom: 0.15em;
		background: linear-gradient(135deg, var(--text) 0%, var(--accent) 100%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	.hero-description {
		font-size: 1.15rem;
		line-height: 1.65;
		color: var(--text-muted);
		margin: 0 0 2.5rem;
		max-width: 520px;
	}

	.hero-actions {
		display: flex;
		gap: 1rem;
	}

	.btn-lg {
		padding: 0.9rem 2rem;
		font-size: 1.05rem;
		border-radius: 16px;
	}

	/* ─── Ambient orbs ────────────────────────────── */
	.hero-visual {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(80px);
		opacity: 0.35;
	}

	.orb-1 {
		width: 400px;
		height: 400px;
		background: var(--accent);
		top: -5%;
		right: 5%;
		animation: float 8s ease-in-out infinite;
	}

	.orb-2 {
		width: 250px;
		height: 250px;
		background: var(--accent-2);
		bottom: 10%;
		right: 20%;
		animation: float 10s ease-in-out infinite reverse;
	}

	.orb-3 {
		width: 180px;
		height: 180px;
		background: var(--orb-3-color);
		top: 30%;
		right: 35%;
		animation: float 12s ease-in-out infinite;
	}

	@keyframes float {
		0%,
		100% {
			transform: translateY(0) scale(1);
		}
		50% {
			transform: translateY(-30px) scale(1.05);
		}
	}

	/* ─── Features ────────────────────────────────── */
	.features-section {
		padding: 2rem 0 4rem;
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1.5rem;
	}

	.feature-card {
		padding: 1.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		backdrop-filter: blur(var(--blur-glass));
		transition: border-color 0.2s;
	}

	.feature-card:hover {
		border-color: var(--card-hover-border);
	}

	.feature-icon {
		font-size: 1.8rem;
		display: block;
		margin-bottom: 0.75rem;
	}

	.feature-card h3 {
		margin: 0 0 0.5rem;
		font-size: 1.1rem;
		font-weight: 700;
	}

	.feature-card p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.92rem;
		line-height: 1.55;
	}

	@media (max-width: 768px) {
		.hero-section {
			padding: 2rem 0 3rem;
			min-height: auto;
		}

		.hero-title {
			font-size: 2.5rem;
		}
	}
</style>
