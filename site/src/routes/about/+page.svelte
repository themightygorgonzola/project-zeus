<svelte:head>
	<title>Project Nornyx | About</title>
	<meta name="description" content="Learn what Project Nornyx is — an AI-guided 5e adventure platform built on procedurally generated worlds, living lore, and true D&D mechanics." />
</svelte:head>

<div class="about-page">

	<!-- ── Hero ─────────────────────────────────────────── -->
	<section class="about-hero">
		<p class="eyebrow">Our Vision</p>
		<h1 class="about-title">What is Project Nornyx?</h1>
		<p class="about-lead">
			Project Nornyx is an AI-powered tabletop adventure platform. We combine procedurally
			generated worlds, an intelligent GM narrator, and the full depth of 5th Edition rules
			to create campaigns that feel alive — whether you're playing solo at midnight or
			adventuring with a party of friends across the world.
		</p>
		<p class="about-lead">
			No DM required. No session scheduling. Just you, a richly imagined world, and a story
			that responds to every choice you make.
		</p>
	</section>

	<!-- ── Feature Cards ─────────────────────────────────── -->
	<section class="features-section">
		<div class="feature-grid">
			<div class="feature-card">
				<span class="feature-icon">🌍</span>
				<h3>AI World-Building</h3>
				<p>Every campaign begins with a procedurally generated world — continents, cities,
				cultures, religions, political factions, and trade routes. The AI doesn't just know
				the map; it reasons about it, creating narrative hooks grounded in the world's
				actual history and geography.</p>
			</div>
			<div class="feature-card">
				<span class="feature-icon">📖</span>
				<h3>Living Lore</h3>
				<p>The world is not static. Factions rise and fall, NPCs remember your actions,
				and the consequences of your choices ripple forward through time. Every session
				adds to a persistent world state that shapes every encounter after it.</p>
			</div>
			<div class="feature-card">
				<span class="feature-icon">⚔️</span>
				<h3>True 5e Mechanics</h3>
				<p>Built from the ground up on the 5th Edition ruleset. Character creation,
				classes, subclasses, feats, multiclassing, spellcasting, conditions, resting —
				the rules you already know, enforced faithfully by an AI that never forgets
				a modifier.</p>
			</div>
		</div>
	</section>

	<!-- ── How It Works ──────────────────────────────────── -->
	<section class="how-section">
		<h2 class="section-title">How It Works</h2>
		<div class="steps">
			<div class="step">
				<span class="step-num">1</span>
				<div class="step-body">
					<h3>Create Your Character</h3>
					<p>Choose your race, class, background, and starting abilities. The same
					character creation flow you know from tabletop — guided by the platform,
					no rule-lookup needed.</p>
				</div>
			</div>
			<div class="step-arrow">→</div>
			<div class="step">
				<span class="step-num">2</span>
				<div class="step-body">
					<h3>Enter the World</h3>
					<p>A unique world is generated for your campaign — name, geography, factions,
					and an opening scene crafted by the AI narrator to set your story in motion.</p>
				</div>
			</div>
			<div class="step-arrow">→</div>
			<div class="step">
				<span class="step-num">3</span>
				<div class="step-body">
					<h3>Shape the Story</h3>
					<p>Every turn is yours. Describe your action in plain language, and the AI GM
					resolves it against the rules and the world state — narrating the outcome,
					tracking consequences, and advancing the campaign.</p>
				</div>
			</div>
		</div>
	</section>

	<!-- ── Built By ──────────────────────────────────────── -->
	<section class="built-section">
		<div class="built-card">
			<span class="built-icon">🐱</span>
			<div class="built-body">
				<h2>Built by adventurers, for adventurers.</h2>
				<p>
					Project Nornyx grew out of a simple frustration: finding time for a full
					tabletop group is hard. We wanted the depth and drama of a real campaign
					available whenever inspiration strikes — without the scheduling overhead,
					without a pre-written module, and without watering down the rules.
				</p>
				<p>
					This is an early-access project, actively developed and shaped by the
					feedback of our growing community. Every session you play helps us make
					the world — and the AI — smarter.
				</p>
				<a href="/auth/login" class="btn btn-primary">Begin Your Adventure</a>
			</div>
		</div>
	</section>

</div>

<style>
	.about-page {
		width: min(1100px, calc(100vw - 32px));
		margin: 0 auto;
		padding-bottom: 4rem;
	}

	/* ── Hero ──────────────────────────────────────── */
	.about-hero {
		padding: 4rem 0.5rem 3rem;
		max-width: 760px;
	}

	.eyebrow {
		color: var(--accent);
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		margin: 0 0 0.75rem;
	}

	.about-title {
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3.5rem);
		font-weight: 700;
		line-height: 1.2;
		margin: 0 0 1.5rem;
		padding-bottom: 0.15em;
		background: linear-gradient(135deg, var(--text) 0%, var(--accent) 100%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	.about-lead {
		font-size: 1.1rem;
		line-height: 1.7;
		color: var(--text-muted);
		margin: 0 0 1rem;
		max-width: 680px;
	}

	/* ── Feature grid ──────────────────────────────── */
	.features-section {
		padding: 1rem 0 3rem;
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
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
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text);
	}

	.feature-card p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.9rem;
		line-height: 1.6;
	}

	/* ── How It Works ──────────────────────────────── */
	.how-section {
		padding: 2rem 0 3rem;
	}

	.section-title {
		font-family: var(--font-display);
		font-size: 1.6rem;
		font-weight: 700;
		margin: 0 0 2rem 0.5rem;
		color: var(--text);
	}

	.steps {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.step {
		flex: 1;
		min-width: 200px;
		display: flex;
		gap: 1rem;
		padding: 1.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		backdrop-filter: blur(var(--blur-glass));
	}

	.step-num {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
		font-weight: 800;
		font-size: 1rem;
		flex-shrink: 0;
	}

	.step-body h3 {
		margin: 0 0 0.4rem;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--text);
	}

	.step-body p {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-muted);
		line-height: 1.55;
	}

	.step-arrow {
		align-self: center;
		font-size: 1.4rem;
		color: var(--text-muted);
		flex-shrink: 0;
		padding-top: 0.25rem;
	}

	/* ── Built By ──────────────────────────────────── */
	.built-section {
		padding: 1rem 0 2rem;
	}

	.built-card {
		display: flex;
		gap: 2rem;
		align-items: flex-start;
		padding: 2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		backdrop-filter: blur(var(--blur-glass));
	}

	.built-icon {
		font-size: 3rem;
		flex-shrink: 0;
		line-height: 1;
		padding-top: 0.25rem;
	}

	.built-body h2 {
		margin: 0 0 1rem;
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 700;
		color: var(--text);
	}

	.built-body p {
		margin: 0 0 0.9rem;
		color: var(--text-muted);
		font-size: 0.95rem;
		line-height: 1.65;
	}

	.built-body .btn {
		margin-top: 0.5rem;
	}

	/* ── Responsive ────────────────────────────────── */
	@media (max-width: 640px) {
		.about-hero {
			padding: 2.5rem 0.5rem 2rem;
		}

		.steps {
			flex-direction: column;
		}

		.step-arrow {
			display: none;
		}

		.built-card {
			flex-direction: column;
			gap: 1rem;
		}
	}
</style>
