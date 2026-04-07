import { dbClient } from './client';

let bootstrapped = false;

export async function bootstrapDatabase() {
	if (bootstrapped) {
		return;
	}

	await dbClient.execute(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY NOT NULL,
			google_id TEXT UNIQUE,
			discord_id TEXT UNIQUE,
			email TEXT UNIQUE,
			username TEXT NOT NULL,
			avatar_url TEXT,
			is_test_user INTEGER NOT NULL DEFAULT 0,
			is_admin INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		)
	`);

	await dbClient.execute(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY NOT NULL,
			user_id TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)
	`);

	await dbClient.execute(`
		CREATE TABLE IF NOT EXISTS adventures (
			id TEXT PRIMARY KEY NOT NULL,
			name TEXT NOT NULL,
			owner_id TEXT NOT NULL,
			world_seed TEXT,
			mode TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'lobby',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id)
		)
	`);

	await dbClient.execute(`
		CREATE TABLE IF NOT EXISTS adventure_members (
			adventure_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			role TEXT NOT NULL,
			is_ready INTEGER NOT NULL DEFAULT 0,
			joined_at INTEGER NOT NULL,
			FOREIGN KEY (adventure_id) REFERENCES adventures(id),
			FOREIGN KEY (user_id) REFERENCES users(id)
		)
	`);

	await dbClient.execute(`
		CREATE TABLE IF NOT EXISTS adventure_state (
			adventure_id TEXT PRIMARY KEY NOT NULL,
			state_json TEXT NOT NULL DEFAULT '{}',
			updated_at INTEGER NOT NULL,
			FOREIGN KEY (adventure_id) REFERENCES adventures(id)
		)
	`);

	await dbClient.execute(`
		CREATE TABLE IF NOT EXISTS adventure_chat (
			id TEXT PRIMARY KEY NOT NULL,
			adventure_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			username TEXT NOT NULL,
			text TEXT NOT NULL,
			mentions_json TEXT NOT NULL DEFAULT '[]',
			retro_invoked INTEGER NOT NULL DEFAULT 0,
			consumed_by_turn INTEGER,
			created_at INTEGER NOT NULL,
			FOREIGN KEY (adventure_id) REFERENCES adventures(id),
			FOREIGN KEY (user_id) REFERENCES users(id)
		)
	`);

	await dbClient.execute(`
		CREATE TABLE IF NOT EXISTS adventure_turns (
			id TEXT PRIMARY KEY NOT NULL,
			adventure_id TEXT NOT NULL,
			turn_number INTEGER NOT NULL,
			actor_type TEXT NOT NULL,
			actor_id TEXT NOT NULL,
			action TEXT NOT NULL DEFAULT '',
			intent TEXT NOT NULL DEFAULT 'unknown',
			status TEXT NOT NULL DEFAULT 'completed',
			resolved_summary TEXT NOT NULL DEFAULT '',
			mechanics_json TEXT NOT NULL DEFAULT '[]',
			state_changes_json TEXT NOT NULL DEFAULT '{}',
			narrative_text TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			FOREIGN KEY (adventure_id) REFERENCES adventures(id)
		)
	`);

	// ─── Schema migrations for existing databases ────────────
	// These are idempotent — safe to run repeatedly.
	try {
		await dbClient.execute(`ALTER TABLE adventure_turns ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'`);
	} catch { /* column already exists */ }

	try {
		await dbClient.execute(`ALTER TABLE adventure_turns ADD COLUMN resolved_summary TEXT NOT NULL DEFAULT ''`);
	} catch { /* column already exists */ }

	try {
		await dbClient.execute(`ALTER TABLE adventure_turns ADD COLUMN debug_json TEXT`);
	} catch { /* column already exists */ }

	// ─── Indexes for common query paths ──────────────────────
	await dbClient.execute(
		'CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)'
	);
	await dbClient.execute(
		'CREATE INDEX IF NOT EXISTS adventure_members_adventure_id_idx ON adventure_members(adventure_id)'
	);
	await dbClient.execute(
		'CREATE INDEX IF NOT EXISTS adventure_members_user_id_idx ON adventure_members(user_id)'
	);
	await dbClient.execute(
		'CREATE INDEX IF NOT EXISTS adventure_turns_adventure_id_idx ON adventure_turns(adventure_id)'
	);
	await dbClient.execute(
		'CREATE INDEX IF NOT EXISTS adventure_turns_turn_number_idx ON adventure_turns(adventure_id, turn_number)'
	);
	await dbClient.execute(
		'CREATE INDEX IF NOT EXISTS adventure_chat_adventure_id_idx ON adventure_chat(adventure_id)'
	);
	await dbClient.execute(
		'CREATE INDEX IF NOT EXISTS adventure_chat_created_at_idx ON adventure_chat(adventure_id, created_at)'
	);

	bootstrapped = true;
}
