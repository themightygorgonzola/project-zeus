/**
 * PartyKit server — one room per adventure.
 *
 * Room ID = adventure ULID (e.g. "01HXYZ...")
 *
 * Message types sent from clients:
 *   { type: "player:ready" }
 *   { type: "player:chat", text: string }
 *
 * Message types broadcast by server:
 *   { type: "player:joined",  connectionId: string }
 *   { type: "player:left",   connectionId: string }
 *   { type: "player:ready",  connectionId: string }
 *   { type: "player:chat",   connectionId: string, text: string }
 *   { type: "ai:turn:start" }
 *   { type: "ai:turn:chunk", text: string }
 *   { type: "ai:turn:end",   text: string }
 */

import type * as Party from "partykit/server";

export default class AdventureRoom implements Party.Server {
  constructor(readonly room: Party.Room) {}

  // ── lifecycle ──────────────────────────────────────────────────────────────

  onConnect(conn: Party.Connection) {
    this.room.broadcast(
      JSON.stringify({ type: "player:joined", connectionId: conn.id }),
      [conn.id] // don't echo to the joiner
    );
  }

  onClose(conn: Party.Connection) {
    this.room.broadcast(
      JSON.stringify({ type: "player:left", connectionId: conn.id })
    );
  }

  // ── messages ───────────────────────────────────────────────────────────────

  onMessage(message: string, sender: Party.Connection) {
    let data: { type: string; [key: string]: unknown };
    try {
      data = JSON.parse(message);
    } catch {
      console.warn("non-JSON message ignored", message);
      return;
    }

    switch (data.type) {
      case "player:ready":
        this.room.broadcast(
          JSON.stringify({
            type: "player:ready",
            connectionId: sender.id,
            userId: data.userId,
            isReady: data.isReady,
          }),
          [sender.id] // don't echo to sender — they already updated optimistically
        );
        break;

      case "player:chat":
        // Exclude sender — they've already added their own message optimistically
        this.room.broadcast(
          JSON.stringify({
            type: "player:chat",
            connectionId: sender.id,
            userId: data.userId,
            username: data.username,
            text: data.text,
          }),
          [sender.id]
        );
        break;

      case "adventure:started":
        // Broadcast to everyone except the sender who is already redirecting
        this.room.broadcast(
          JSON.stringify({ type: "adventure:started" }),
          [sender.id]
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

    // Forward AI turn events to all connected players
    if (
      body.type === "ai:turn:start" ||
      body.type === "ai:turn:chunk" ||
      body.type === "ai:turn:end"
    ) {
      this.room.broadcast(JSON.stringify(body));
      return new Response("ok");
    }

    return new Response("Unknown event type", { status: 422 });
  }
}

export const onFetch = AdventureRoom;
