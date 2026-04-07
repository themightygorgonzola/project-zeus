<svelte:head>
	<title>Project Nornyx | Reviews</title>
	<meta name="description" content="What adventurers are saying about Project Nornyx — early access feedback from players exploring AI-guided 5e campaigns." />
</svelte:head>

<script lang="ts">
	const testimonials = [
		{
			quote: "I've played tabletop for fifteen years. I expected a watered-down imitation — I got a campaign that remembered every NPC I'd ever spoken to. It's uncanny.",
			name: "Elara V.",
			initial: "E",
			stars: 5,
			tag: "Wizard · Solo Campaign",
			accent: "#7c9cff"
		},
		{
			quote: "We ran a three-person party through a war-torn kingdom arc. The AI kept track of our morally grey choices and let us feel the consequences two sessions later. Incredible.",
			name: "Tormund R.",
			initial: "T",
			stars: 5,
			tag: "Fighter · Multiplayer",
			accent: "#c084fc"
		},
		{
			quote: "The world-building is genuinely surprising. Our continent had a religion, a civil war scar, and a trade dispute baked in before we took a single step.",
			name: "Sable M.",
			initial: "S",
			stars: 5,
			tag: "Rogue · Solo Campaign",
			accent: "#34d3a2"
		},
		{
			quote: "Playing a Paladin who broke their oath and actually had to navigate the mechanical consequences felt more real here than most in-person sessions I've had.",
			name: "Drin K.",
			initial: "D",
			stars: 5,
			tag: "Paladin · Solo Campaign",
			accent: "#f59e0b"
		},
		{
			quote: "The 5e rules implementation is tighter than I expected for an AI platform. Spellslots, concentration, opportunity attacks — it tracks all of it cleanly.",
			name: "Aelys C.",
			initial: "A",
			stars: 5,
			tag: "Cleric · Multiplayer",
			accent: "#4ade80"
		},
		{
			quote: "Ran a Barbarian who couldn't read. The AI leaned in — it described every scroll as 'ink-covered parchment, meaning unknown.' That kind of texture is rare.",
			name: "Holt B.",
			initial: "H",
			stars: 5,
			tag: "Barbarian · Solo Campaign",
			accent: "#ff4500"
		}
	];
</script>

<div class="reviews-page">

	<!-- ── Header ────────────────────────────────────────── -->
	<section class="reviews-hero">
		<p class="eyebrow">Early Access Feedback</p>
		<h1 class="reviews-title">What Adventurers Say</h1>
		<p class="reviews-lead">
			Project Nornyx is in active early access. These are the stories our players are
			telling — unfiltered and unedited (names shortened for privacy).
		</p>
	</section>

	<!-- ── Testimonial Grid ──────────────────────────────── -->
	<section class="testimonials-section">
		<div class="testimonial-grid">
			{#each testimonials as t}
				<div class="testimonial-card">
					<div class="stars" aria-label="{t.stars} out of 5 stars">
						{#each { length: t.stars } as _}
							<span class="star">★</span>
						{/each}
					</div>
					<blockquote class="quote">"{t.quote}"</blockquote>
					<div class="reviewer">
						<div class="reviewer-avatar" style="--av-color: {t.accent}">
							{t.initial}
						</div>
						<div class="reviewer-meta">
							<span class="reviewer-name">{t.name}</span>
							<span class="reviewer-tag">{t.tag}</span>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- ── CTA Strip ─────────────────────────────────────── -->
	<section class="cta-strip">
		<div class="cta-inner">
			<div class="cta-text">
				<h2>Your story is waiting.</h2>
				<p>Join hundreds of adventurers shaping the worlds of Project Nornyx — and leave your own mark on its history.</p>
			</div>
			<div class="cta-actions">
				<a href="/auth/login" class="btn btn-primary btn-lg">Begin Your Adventure</a>
				<a href="#" class="btn btn-ghost btn-lg">Join the Discord</a>
			</div>
		</div>
	</section>

</div>

<style>
	.reviews-page {
		width: min(1100px, calc(100vw - 32px));
		margin: 0 auto;
		padding-bottom: 4rem;
	}

	/* ── Hero ──────────────────────────────────────── */
	.reviews-hero {
		padding: 4rem 0.5rem 3rem;
		max-width: 680px;
	}

	.eyebrow {
		color: var(--accent);
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		margin: 0 0 0.75rem;
	}

	.reviews-title {
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3.5rem);
		font-weight: 700;
		line-height: 1.2;
		margin: 0 0 1.25rem;
		padding-bottom: 0.15em;
		background: linear-gradient(135deg, var(--text) 0%, var(--accent) 100%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	.reviews-lead {
		font-size: 1.05rem;
		line-height: 1.65;
		color: var(--text-muted);
		margin: 0;
	}

	/* ── Testimonial grid ──────────────────────────── */
	.testimonials-section {
		padding: 0.5rem 0 3rem;
	}

	.testimonial-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.25rem;
	}

	.testimonial-card {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.6rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		backdrop-filter: blur(var(--blur-glass));
		transition: border-color 0.2s;
	}

	.testimonial-card:hover {
		border-color: var(--card-hover-border);
	}

	.stars {
		display: flex;
		gap: 2px;
	}

	.star {
		color: var(--warning);
		font-size: 0.9rem;
	}

	.quote {
		margin: 0;
		font-size: 0.92rem;
		line-height: 1.65;
		color: var(--text);
		font-style: italic;
		flex: 1;
	}

	.reviewer {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
	}

	.reviewer-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--av-color, var(--accent)) 20%, transparent);
		color: var(--av-color, var(--accent));
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.9rem;
		flex-shrink: 0;
		border: 1px solid color-mix(in srgb, var(--av-color, var(--accent)) 35%, transparent);
	}

	.reviewer-meta {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.reviewer-name {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text);
	}

	.reviewer-tag {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	/* ── CTA strip ─────────────────────────────────── */
	.cta-strip {
		margin-top: 1rem;
		border-radius: var(--radius-lg);
		background: var(--surface);
		border: 1px solid var(--border);
		backdrop-filter: blur(var(--blur-glass));
	}

	.cta-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		padding: 2rem 2.5rem;
		flex-wrap: wrap;
	}

	.cta-text h2 {
		margin: 0 0 0.4rem;
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--text);
	}

	.cta-text p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.9rem;
		line-height: 1.5;
		max-width: 480px;
	}

	.cta-actions {
		display: flex;
		gap: 0.75rem;
		flex-shrink: 0;
		flex-wrap: wrap;
	}

	.btn-lg {
		padding: 0.75rem 1.5rem;
		font-size: 0.95rem;
	}

	/* ── Responsive ────────────────────────────────── */
	@media (max-width: 640px) {
		.reviews-hero {
			padding: 2.5rem 0.5rem 2rem;
		}

		.cta-inner {
			padding: 1.5rem;
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
