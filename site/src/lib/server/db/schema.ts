import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ─── Users ───────────────────────────────────────────────
export const users = sqliteTable('users', {
	id: text('id').primaryKey(), // ULID
	googleId: text('google_id').unique(),
	discordId: text('discord_id').unique(),
	email: text('email').unique(),
	username: text('username').notNull(),
	avatarUrl: text('avatar_url'),
	isTestUser: integer('is_test_user', { mode: 'boolean' }).notNull().default(false),
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'number' }).notNull()
});

// ─── Sessions ────────────────────────────────────────────
export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(), // random token
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		expiresAt: integer('expires_at', { mode: 'number' }).notNull()
	},
	(t) => [index('sessions_user_id_idx').on(t.userId)]
);

// ─── Adventures ──────────────────────────────────────────
export const adventures = sqliteTable('adventures', {
	id: text('id').primaryKey(), // ULID
	name: text('name').notNull(),
	ownerId: text('owner_id')
		.notNull()
		.references(() => users.id),
	worldSeed: text('world_seed'),
	mode: text('mode', { enum: ['solo', 'multiplayer'] }).notNull(),
	status: text('status', { enum: ['lobby', 'active', 'completed'] })
		.notNull()
		.default('lobby'),
	createdAt: integer('created_at', { mode: 'number' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'number' }).notNull()
});

// ─── Adventure Members ───────────────────────────────────
export const adventureMembers = sqliteTable(
	'adventure_members',
	{
		adventureId: text('adventure_id')
			.notNull()
			.references(() => adventures.id),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		role: text('role', { enum: ['owner', 'player'] }).notNull(),
		isReady: integer('is_ready', { mode: 'boolean' }).notNull().default(false),
		joinedAt: integer('joined_at', { mode: 'number' }).notNull()
	},
	(t) => [
		index('adventure_members_adventure_id_idx').on(t.adventureId),
		index('adventure_members_user_id_idx').on(t.userId)
	]
);

// ─── Adventure State ─────────────────────────────────────
export const adventureState = sqliteTable('adventure_state', {
	adventureId: text('adventure_id')
		.primaryKey()
		.references(() => adventures.id),
	stateJson: text('state_json').notNull().default('{}'),
	updatedAt: integer('updated_at', { mode: 'number' }).notNull()
});

// ─── Adventure Turns (durable turn/chat history) ─────────
export const adventureTurns = sqliteTable(
	'adventure_turns',
	{
		id: text('id').primaryKey(), // ULID
		adventureId: text('adventure_id')
			.notNull()
			.references(() => adventures.id),
		turnNumber: integer('turn_number', { mode: 'number' }).notNull(),
		actorType: text('actor_type', { enum: ['player', 'gm'] }).notNull(),
		actorId: text('actor_id').notNull(),
		action: text('action').notNull().default(''),
		intent: text('intent').notNull().default('unknown'),
		mechanicsJson: text('mechanics_json').notNull().default('[]'),
		stateChangesJson: text('state_changes_json').notNull().default('{}'),
		narrativeText: text('narrative_text').notNull().default(''),
		createdAt: integer('created_at', { mode: 'number' }).notNull()
	},
	(t) => [
		index('adventure_turns_adventure_id_idx').on(t.adventureId),
		index('adventure_turns_turn_number_idx').on(t.adventureId, t.turnNumber)
	]
);
