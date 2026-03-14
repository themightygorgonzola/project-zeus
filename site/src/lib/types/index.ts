export interface User {
	id: string;
	username: string;
	avatarUrl: string | null;
	googleId: string | null;
	discordId: string | null;
	email: string | null;
	isTestUser: boolean;
	isAdmin: boolean;
	createdAt: number;
}

export type AdventureMode = 'solo' | 'multiplayer';
export type AdventureStatus = 'lobby' | 'active' | 'completed';

export interface Adventure {
	id: string;
	name: string;
	ownerId: string;
	worldSeed: string | null;
	mode: AdventureMode;
	status: AdventureStatus;
	createdAt: number;
	updatedAt: number;
}

export interface AdventureMember {
	adventureId: string;
	userId: string;
	role: 'owner' | 'player';
	isReady: boolean;
	joinedAt: number;
}

export interface LobbyMember extends AdventureMember {
	username: string;
	avatarUrl: string | null;
}

export interface LobbyState {
	adventure: Adventure;
	members: LobbyMember[];
	allReady: boolean;
}
