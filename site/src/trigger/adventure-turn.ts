/**
 * Trigger.dev background task — AI storyteller turn.
 *
 * Triggered when a player submits an action in an adventure.
 * Runs the OpenAI completion, streams chunks back via PartyKit,
 * then persists the final narrative to Turso.
 *
 * Payload:
 *   adventureId  — ULID of the adventure room
 *   playerAction — the player's free-text action
 *   history      — recent narrative history for context
 */

import { task } from "@trigger.dev/sdk/v3";

export interface AdventureTurnPayload {
  adventureId: string;
  playerAction: string;
  history: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

export const adventureTurn = task({
  id: "adventure-turn",
  // Retry config inherits from trigger.config.ts defaults
  run: async (payload: AdventureTurnPayload) => {
    const { adventureId, playerAction, history } = payload;

    const partyHost = process.env.PARTYKIT_HOST;
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiModel = process.env.OPENAI_MODEL ?? "gpt-4o";

    if (!partyHost) throw new Error("PARTYKIT_HOST env var is not set");
    if (!openaiKey) throw new Error("OPENAI_API_KEY env var is not set");

    // 1. Notify players that the AI turn has started
    await notifyRoom(partyHost, adventureId, { type: "ai:turn:start" });

    // 2. Call OpenAI (non-streaming for now; swap for streaming once stable)
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [
          ...history,
          { role: "user", content: playerAction },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const completion = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const narrativeText = completion.choices[0]?.message.content ?? "";

    // 3. Broadcast the result to all players in the room
    await notifyRoom(partyHost, adventureId, {
      type: "ai:turn:end",
      text: narrativeText,
    });

    // 4. TODO: persist narrativeText to Turso (adventureState logs)

    return { adventureId, narrativeText };
  },
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function notifyRoom(
  host: string,
  roomId: string,
  body: Record<string, unknown>
): Promise<void> {
  const url = `https://${host}/parties/main/${roomId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn(`PartyKit notify failed (${res.status}): ${await res.text()}`);
  }
}
