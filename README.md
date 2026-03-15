# Project Zeus

Project Zeus is a multiplayer AI-assisted tabletop adventure prototype.

It currently combines:

- a SvelteKit app in `site/`
- Turso for durable state
- PartyKit for realtime room delivery
- Trigger.dev for background jobs
- OpenAI for GM responses
- Vercel for the main web deployment

There is also an older root-level CLI in `src/` for direct OpenAI querying, but the actively evolving game app lives in `site/`.

---

## What this repository contains

### Main surfaces

- `site/`
  - the live app
  - SvelteKit + Vercel adapter
  - auth, lobby, adventure UI, PartyKit client, GM chat integration
- `site/party/`
  - PartyKit room server
  - handles realtime ready-state and chat fanout
- `site/src/trigger/`
  - Trigger.dev tasks
  - background AI / long-form workflow entrypoints
- `site/src/lib/server/ai/`
  - shared AI orchestration layer
  - model routing, OpenAI calls, PartyKit AI event fanout
- `scripts/`
  - Windows-safe helper scripts for validation, local dev, and releases
- `src/`
  - legacy root CLI for direct OpenAI commands

### Important current behavior

- lobby ready-state is **ephemeral** and lives in PartyKit memory
- durable adventure state lives in Turso
- interactive `/gm` chat now defaults to an **inline fast path** through the app server
- slower / heavier AI jobs can still go through Trigger.dev using the same shared AI execution logic

---

## Repo operating rule: where to run commands from

### Always manage git from the repo root

Use:

`c:\MySoftwareFolder\project-zeus`

This avoids the most common confusion in this repo: mixing root git actions with `site/` package actions.

### Use helper scripts from the repo root whenever possible

The safest default on this machine is:

- run helper `.bat` files from `scripts/`
- let them locate `site/`
- let them use `npm.cmd` instead of `npm.ps1`

This is important because PowerShell execution policy on this machine can block `npm` / `npx` script shims.

---

## Architecture in plain English

### Durable state

Turso is the source of truth for:

- adventure rows
- membership
- saved world data
- adventure state
- future persisted transcript / summary data

### Realtime state

PartyKit is the source of truth for live room behavior such as:

- ready toggles in the lobby
- party chat fanout
- GM typing / chunk / final response fanout

If the room hibernates because everyone leaves, PartyKit memory is lost. That is fine for ephemeral ready-state.

### Interactive AI flow

For `/gm ...` chat:

1. browser sends request to the app
2. app uses the shared AI routing layer
3. interactive mode defaults to **inline** execution
4. app immediately notifies PartyKit that the GM is starting
5. app streams OpenAI chunks
6. PartyKit broadcasts those chunks to all connected players

This avoids the extra queue/startup latency of always going through Trigger.dev.

### Background AI flow

For long or non-urgent jobs:

1. app uses the same AI routing layer
2. wrapper chooses background mode
3. Trigger.dev runs the job
4. job reuses the shared AI execution logic
5. PartyKit still delivers the live events back into the room

This means the execution model can change without rewriting the feature layer.

---

## Service responsibilities

### Vercel

Hosts the SvelteKit app in `site/`.

Used for:

- HTTP routes
- auth
- inline AI request handling
- rendered pages

Auto-deploys on push to `main`.

### PartyKit

Hosts the realtime room server defined by:

- `site/partykit.json`
- `site/party/server.ts`

Used for:

- lobby ready-state
- chat fanout
- AI streaming fanout

**Does not auto-deploy from git.**

PartyKit must be deployed manually whenever PartyKit server code changes.

### Trigger.dev

Hosts background jobs defined in:

- `site/trigger.config.ts`
- `site/src/trigger/`

Used for:

- background AI tasks
- long-running workflows
- future scheduled/cleanup tasks

Production deploys are triggered by GitHub Actions on push to `main`.

### OpenAI

Provides model inference.

Current plumbing is OpenAI-only, but model selection is now centralized so the request layer is model-agnostic within OpenAI and future provider expansion is straightforward.

---

## Key files worth knowing

### Core app and infra

- `site/src/routes/adventures/[id]/+page.svelte`
  - main adventure screen
  - chat UI
  - `/gm` entrypoint from the client
- `site/src/routes/api/adventure/[id]/turn/+server.ts`
  - server-side turn dispatch route
- `site/src/lib/server/ai/adventure-turn.ts`
  - AI routing wrapper
- `site/src/lib/server/ai/openai.ts`
  - low-level OpenAI completion + streaming helpers
- `site/src/lib/server/ai/party.ts`
  - PartyKit room HTTP notification helper
- `site/src/trigger/adventure-turn.ts`
  - background Trigger.dev task
- `site/party/server.ts`
  - PartyKit room server
- `.github/workflows/trigger-deploy.yml`
  - automatic Trigger.dev production deploy workflow

### Env and config

- `site/.env.example`
- `site/partykit.json`
- `site/trigger.config.ts`
- `site/svelte.config.js`

---

## Local development

### Required local services

For a full local multiplayer / AI loop you usually want all three running:

1. app server
2. PartyKit dev server
3. Trigger.dev dev tunnel (only needed if you are testing background mode)

### Recommended local start command on Windows

From the repo root:

```bat
scripts\site-dev.bat
```

This opens separate `cmd.exe` windows for:

- `npm run dev`
- `npm run party:dev`
- `npm run trigger:dev`

You can also launch only one service:

```bat
scripts\site-dev.bat --app
scripts\site-dev.bat --party
scripts\site-dev.bat --trigger
```

Help:

```bat
scripts\site-dev.bat --help
```

### Validate before pushing

From the repo root:

```bat
scripts\site-check.bat
```

This runs the site `check` script safely using `npm.cmd` rather than the blocked PowerShell shim.

---

## Environment variable ownership

This is one of the most important sections in the whole repo.

### 1. Local `site/.env`

Used for local dev only.

Common values:

- `TURSO_URL`
- `TURSO_AUTH_TOKEN`
- OAuth credentials
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_MODEL_INTERACTIVE`
- `OPENAI_MODEL_BACKGROUND`
- `TRIGGER_SECRET_KEY=tr_dev_...`
- `PUBLIC_PARTYKIT_HOST=localhost:1999`
- `PARTYKIT_HOST=localhost:1999`
- `AI_INTERACTIVE_MODE=inline`

### 2. Vercel env vars

Used by the deployed app.

Important values:

- Turso credentials
- OAuth credentials
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- optional `OPENAI_MODEL_INTERACTIVE`
- optional `OPENAI_MODEL_BACKGROUND`
- `TRIGGER_SECRET_KEY=tr_prod_...`
- `PUBLIC_PARTYKIT_HOST=project-zeus.themightygorgonzola.partykit.dev`
- `PARTYKIT_HOST=project-zeus.themightygorgonzola.partykit.dev`
- optional `AI_INTERACTIVE_MODE=inline`

### 3. Trigger.dev production env vars

Used by Trigger.dev task runtime itself.

Important values:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- optional `OPENAI_MODEL_INTERACTIVE`
- optional `OPENAI_MODEL_BACKGROUND`
- `PARTYKIT_HOST=project-zeus.themightygorgonzola.partykit.dev`
- optional `AI_INTERACTIVE_MODE=background` if you explicitly want Trigger-first behavior for some jobs

Important: Trigger.dev does **not** read Vercel env vars automatically.

### 4. GitHub Actions repository secret

Required for Trigger.dev deploy automation:

- `TRIGGER_ACCESS_TOKEN`

This lives in GitHub repository secrets, not in `.env`.

---

## Deployment rules: what deploys automatically and what does not

| Surface | Deployment trigger | Automatic? | Notes |
|---|---|---:|---|
| Vercel app | push to `main` | Yes | deploys the `site/` app |
| Trigger.dev tasks | push to `main` via GitHub Action | Yes | requires `TRIGGER_ACCESS_TOKEN` secret |
| PartyKit server | `npm run party:deploy` | No | must be run manually when PartyKit code/config changes |

### Changes that require PartyKit deploy

If any of these change, you need a manual PartyKit deploy:

- `site/party/server.ts`
- anything else under `site/party/`
- `site/partykit.json`

### Changes that require Trigger.dev deploy

If any of these change, the GitHub Action should redeploy Trigger automatically after push:

- `site/src/trigger/*`
- `site/trigger.config.ts`
- any shared code used by Trigger tasks, such as `site/src/lib/server/ai/*`

### Changes that require only Vercel deploy

Most page/UI/API route changes only need a normal git push to `main`.

---

## Safe release flow

### Recommended operator command

From the repo root:

```bat
scripts\site-release.bat
```

This does the following in order:

1. checks git status
2. runs `svelte-check`
3. runs `git push`
4. runs PartyKit deploy
5. prints follow-up verification steps

### Variants

Skip the push:

```bat
scripts\site-release.bat --skip-push
```

Skip PartyKit deploy:

```bat
scripts\site-release.bat --skip-party-deploy
```

Allow dirty working tree for a dry run:

```bat
scripts\site-release.bat --allow-dirty --skip-push --skip-party-deploy
```

Help:

```bat
scripts\site-release.bat --help
```

### What the release script does not do

It does not:

- wait for Vercel to finish
- wait for GitHub Actions to finish
- verify Trigger.dev dashboard state automatically
- rotate secrets

It is still the best single command for this repo’s routine release flow on this Windows machine.

---

## Common Windows / terminal issues in this repo

### 1. PowerShell blocks `npm` / `npx`

Symptom:

- `npm.ps1 cannot be loaded because running scripts is disabled`
- `npx.ps1 cannot be loaded because running scripts is disabled`

Use one of these solutions:

- preferred: `scripts\*.bat`
- direct fallback: `npm.cmd run <script>`
- direct fallback: call `node ...\npm-cli.js` if needed

This repo’s helper scripts are designed around that reality.

### 2. Git not found in some terminals

Some shells on this machine do not inherit the expected Git path.

The helper scripts try the common Git for Windows install path:

- `C:\Program Files\Git\cmd`

If git still is not found, install Git for Windows or add it to PATH.

### 3. PartyKit deploy from the wrong directory

Symptom:

- missing `main` entry point
- `partykit.json` not found

Cause:

- deploying from repo root instead of `site/`

Use the helper script or explicitly deploy from `site/`.

### 4. Trigger.dev env mismatch

Trigger.dev tasks do not run with Vercel env vars unless you also add the same values in Trigger.dev project env settings.

### 5. Wrong host split between local and prod

Local dev:

- `PUBLIC_PARTYKIT_HOST=localhost:1999`
- `PARTYKIT_HOST=localhost:1999`

Production:

- `PUBLIC_PARTYKIT_HOST=project-zeus.themightygorgonzola.partykit.dev`
- `PARTYKIT_HOST=project-zeus.themightygorgonzola.partykit.dev`

---

## AI routing model

The AI layer is now structured to support dynamic routing.

### Current request profiles

#### Interactive chat

- purpose: `interactive-chat`
- default mode: `inline`
- default behavior: stream chunks through PartyKit

This is used for `/gm` because first feedback latency matters.

#### Background turn

- purpose: `background-turn`
- default mode: `background`
- default behavior: Trigger.dev task execution

This is for longer or less latency-sensitive work.

### Model selection

Current support is OpenAI-only, but model choice is resolved centrally.

The lookup order is:

- explicit per-request override
- `OPENAI_MODEL_INTERACTIVE` or `OPENAI_MODEL_BACKGROUND`
- fallback `OPENAI_MODEL`
- final fallback `gpt-4o`

---

## Current operator playbooks

### Local smoke test

1. run `scripts\site-dev.bat`
2. open two browser sessions
3. create / join a multiplayer adventure
4. verify lobby ready-state updates instantly
5. start adventure
6. send normal chat
7. send `/gm I inspect the strange altar`

Expected behavior:

- ready-state sync is instant
- normal chat fans out instantly
- GM placeholder appears quickly
- GM response streams in incrementally

### Production smoke test after release

1. run `scripts\site-release.bat`
2. confirm GitHub Action succeeded for Trigger.dev
3. confirm Vercel deployment succeeded
4. test lobby ready-state in prod
5. test `/gm` in prod

### If only UI changed

Usually just push to `main`.

### If `site/party/**` changed

Push to `main` **and** deploy PartyKit.

### If `site/src/trigger/**` changed

Push to `main` and confirm the GitHub Action succeeded.

---

## Theory of the implementation

The repo intentionally splits state by durability requirement.

### Durable truth

Turso stores:

- who the members are
- what the adventure/world is
- whether the adventure has started
- future narrative/event history

### Ephemeral truth

PartyKit stores:

- who is currently connected
- who is ready right now in the live lobby
- live fanout of messages and AI chunks

This keeps realtime behavior fast and simple while durable state remains recoverable.

### Why not put everything in Trigger.dev?

Because interactive GM chat feels much better when the first response is produced directly inside the app request path. Trigger.dev is still valuable for heavier and more reliable background workflows, but it is not the best place to introduce visible startup latency for table chat.

---

## Secrets hygiene

Never paste real secrets into chat, screenshots, or committed files.

Rotate immediately if exposed:

- Turso tokens
- Google OAuth secret
- Discord OAuth secret
- OpenAI key
- Trigger keys / tokens

`.env` is local-only and ignored. `site/.env.example` is the safe template.

---

## Summary: default human workflow

### Build / test locally

```bat
scripts\site-dev.bat
scripts\site-check.bat
```

### Release safely

```bat
scripts\site-release.bat
```

### When in doubt

1. go to repo root
2. use `scripts\*.bat`
3. treat PartyKit deploy as manual unless the script already handled it
4. verify Vercel + GitHub Action after push

That is the intended operating model for this repository.
