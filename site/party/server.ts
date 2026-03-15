/**
 * PartyKit server — one room per adventure.
 *
 * Room ID = adventure ULID.
 * Ready state lives entirely in memory here — Turso is only written
 * when the adventure actually starts (via the /api/lobby/[id]/start endpoint
 * called by each client on receiving adventure:started).
 *
 * Clients pass ?userId=<ulid> as a query param on connect so the server
 * can track unique users across reconnections / multiple tabs.
 *
 * Inbound message types:
 *   { type: "player:ready", isReady: boolean }
 *   { type: "player:chat",  username: string, text: string }
 *
 * Outbound message types:
 *   { type: "player:joined",   userId: string }
 *   { type: "player:left",    userId: string }
 *   { type: "player:ready",   userId: string, isReady: boolean }
 *   { type: "adventure:started" }
 *   { type: "player:chat",    userId: string, username: string, text: string }
 *   { type: "ai:turn:start" }
 *   { type: "ai:turn:chunk",  text: string }
 *   { type: "ai:turn:end",    text: string }
 *   { type: "ai:turn:error",  message: string }
 */

import type * as Party from "partykit/server";

export default class AdventureRoom implements Party.Server {
  // connectionId → userId  (one user may have >1 connection via multiple tabs)
  private connToUser = new Map<string, string>();
  // userId → isReady
  private readyState = new Map<string, boolean>();

  constructor(readonly room: Party.Room) {}

  // ── lifecycle ──────────────────────────────────────────────────────────────

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const userId =
      new URL(ctx.request.url).searchParams.get("userId") ?? conn.id;
    this.connToUser.set(conn.id, userId);

    // Initialise ready state for new users
    if (!this.readyState.has(userId)) {
      this.readyState.set(userId, false);
    }

    this.room.broadcast(
      JSON.stringify({ type: "player:joined", userId }),
      [conn.id]
    );

    // Send current ready state snapshot to the new connection
    const snapshot = Object.fromEntries(this.readyState);
    conn.send(JSON.stringify({ type: "ready:snapshot", snapshot }));
  }

  onClose(conn: Party.Connection) {
    const userId = this.connToUser.get(conn.id);
    this.connToUser.delete(conn.id);

    if (!userId) return;

    // Only treat as fully left if no other connections remain for this user
    const stillConnected = [...this.connToUser.values()].includes(userId);
    if (!stillConnected) {
      this.readyState.delete(userId);
      this.room.broadcast(JSON.stringify({ type: "player:left", userId }));
    }
  }

  // ── messages ───────────────────────────────────────────────────────────────

  onMessage(message: string, sender: Party.Connection) {
    let data: { type: string; [key: string]: unknown };
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const userId = this.connToUser.get(sender.id);
    if (!userId) return;

    switch (data.type) {
      case "player:ready": {
        const isReady = Boolean(data.isReady);
        this.readyState.set(userId, isReady);

        // Broadcast confirmed state to everyone (including sender)
        this.room.broadcast(
          JSON.stringify({ type: "player:ready", userId, isReady })
        );

        // Check if all connected unique users are ready
        const connectedUsers = new Set(this.connToUser.values());
        const allReady =
          connectedUsers.size > 0 &&
          [...connectedUsers].every((uid) => this.readyState.get(uid) === true);

        if (allReady) {
          this.room.broadcast(JSON.stringify({ type: "adventure:started" }));
        }
        break;
      }

      case "player:chat":
        this.room.broadcast(
          JSON.stringify({
            type: "player:chat",
            userId,
            username: data.username,
            text: data.text,
          }),
          [sender.id] // exclude sender — they added the message optimistically
        );
        break;

      default:
        console.warn("unknown message type", data.type);
    }
  }

  // ── HTTP requests (called by Trigger.dev tasks to push AI turns) ──────────

  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body: { type: string; [key: string]: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    if (
      body.type === "ai:turn:start" ||
      body.type === "ai:turn:chunk" ||
      body.type === "ai:turn:end" ||
      body.type === "ai:turn:error"
    ) {
      this.room.broadcast(JSON.stringify(body));
      return new Response("ok");
    }

    return new Response("Unknown event type", { status: 422 });
  }
}

export const onFetch = AdventureRoom;

