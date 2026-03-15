# Project Zeus

Project Zeus is a multiplayer AI-assisted tabletop adventure prototype.

It currently combines:

- a SvelteKit app in `site/`
- Turso for durable state
- PartyKit for realtime room delivery
- Trigger.dev for background jobs
- OpenAI for GM responses
- Vercel for the main web deployment

The actively served application lives in `site/`. Everything outside `site/` is now limited to repository automation and Windows-safe operator helpers.

---

## Fresh clone: start a new workspace from zero

This section is the fastest safe path for a brand-new machine or collaborator.

### 1. Clone the repo

Open a terminal and run:

```powershell
git clone https://github.com/themightygorgonzola/project-zeus.git
cd project-zeus
```

After this, keep using the repo root:

`c:\MySoftwareFolder\project-zeus`

Do **not** treat `site/` as a separate git repo. Git actions should be driven from the repo root.

### 2. Install the site dependencies

From the repo root:

```powershell
cd site
npm install
cd ..
```

The live application is in `site/`, so that is the only package directory that needs `npm install`.

### 3. Create your local env file

Copy:

- `site/.env.example`

to:

- `site/.env`

Then fill in the required local values.

At minimum, local work commonly needs:

- Turso credentials
- OAuth credentials if you are testing auth flows
- `OPENAI_API_KEY` if you are testing GM responses
- local PartyKit host values
- local Trigger.dev dev secret if you are testing background mode

### 4. Start the local workspace

From the repo root:

```bat
scripts\site-dev.bat
```

This is the preferred way to start local development on Windows.

### 5. Check repo/worktree status

From the repo root:

```bat
scripts\site-status.bat
```

Use this instead of raw `git status` unless you are deliberately debugging git.

### 6. Save work safely

From the repo root:

```bat
scripts\site-save.bat --message "describe your change"
```

This is the preferred replacement for manual stage + commit steps.

### 7. Ship work safely

From the repo root:

```bat
scripts\site-ship.bat --message "describe your change"
```

This is the preferred replacement for manually remembering to:

- validate
- commit
- push
- decide whether PartyKit also needs deployment

### Fresh-clone rules

For a new operator, the safest defaults are:

- work from the repo root
- remember the live app is in `site/`
- prefer `scripts\site-status.bat`, `scripts\site-save.bat`, `scripts\site-ship.bat`, `scripts\site-check.bat`, and `scripts\site-dev.bat`
- avoid raw git/npm deployment commands unless you are intentionally debugging

---

## Agent + cooperator handoff packet

If you are handing this repo to another person and another AI agent, the minimum handoff packet should be:

- this `README.md`
- the real local `site/.env` values
- the repo URL
- confirmation that the operator should use `scripts\*.bat` from the repo root

If those four things are present, an agent should be able to walk a cooperator through:

- cloning the repo
- installing dependencies
- starting local development
- understanding which local service is which
- editing the app safely
- testing locally
- validating before release
- saving work with a commit
- pushing to git
- understanding what deploys automatically and what does not

### Requirements before the handoff is useful

The cooperator also needs:

- Git installed
- Node.js installed
- GitHub access to the repo
- permission to log in to any needed services
- the willingness to use the checked-in scripts instead of improvising shell commands

### Most important handoff rule

If there is a choice between a raw command and a checked-in helper script, prefer the helper script.

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
  - Windows-safe helper scripts for status, save, validation, local dev, and releases

### Important current behavior

- lobby ready-state is **ephemeral** and lives in PartyKit memory
- durable adventure state lives in Turso
- interactive `/gm` chat now defaults to an **inline fast path** through the app server
- slower / heavier AI jobs can still go through Trigger.dev using the same shared AI execution logic

### Full stack at a glance

- `site/`
  - SvelteKit app
  - Vite dev server
  - Vercel deployment target
- Turso
  - durable database
- PartyKit
  - realtime room server
- Trigger.dev
  - background task runner
- OpenAI
  - GM/model inference
- `scripts/`
  - Windows-safe operator wrapper layer

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

### Preferred operator commands

If you are not deeply comfortable with git or deployment tooling, use these and stick to them:

- `scripts\site-status.bat`
  - safe repo status
  - tells you whether PartyKit probably needs a deploy
- `scripts\site-save.bat --message "what changed"`
  - runs validation by default
  - stages everything
  - creates a commit
- `scripts\site-ship.bat --message "what changed"`
  - validates
  - saves uncommitted work if needed
  - pushes to git
  - deploys PartyKit only when needed
- `scripts\site-check.bat`
  - validation only
- `scripts\site-dev.bat`
  - local development windows

For routine work, these should be preferred over raw `git add`, `git commit`, `git push`, or manual PartyKit deploy commands.

### Final intended root layout

The root of this repository should stay minimal:

- `site/` — live app and runtime code
- `.github/` — GitHub Actions automation
- `scripts/` — checked-in operator helpers only
- root config/docs files like `README.md`, `.gitignore`, `.gitattributes`

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

### Dev flow vs prod flow

This repo has two main operating modes.

#### Dev flow

Use dev flow when you want to:

- run the site locally
- edit pages, API routes, PartyKit code, or Trigger tasks
- test changes before pushing
- validate that the project still type-checks

Dev flow usually means:

1. `scripts\site-status.bat`
2. `scripts\site-dev.bat`
3. make edits
4. `scripts\site-check.bat`
5. `scripts\site-save.bat --message "describe your change"`

#### Prod flow

Use prod flow when you want to:

- publish changes to the live app
- push committed work to git
- trigger Vercel production deployment
- trigger Trigger.dev production deployment
- deploy PartyKit if PartyKit code changed

Prod flow usually means:

1. `scripts\site-status.bat`
2. `scripts\site-ship.bat --message "describe your change"`

If you want a lower-level, more explicit production flow, use `scripts\site-release.bat`.

### What each local service actually is

This is a common point of confusion.

#### `http://localhost:5173`

This is the main SvelteKit app.

Use this in the browser for normal site work.

#### `http://localhost:1999`

This is the PartyKit dev server.

It is **not** the main app homepage. Visiting it directly may show `404 Not Found`, which is normal. It exists to handle realtime room/socket traffic for the app running on `localhost:5173`.

#### Trigger.dev local dev

This is not usually the thing you browse to directly first. It provides the local Trigger task development flow and may prompt for login in the terminal.

### What `scripts\site-dev.bat` launches

By default, it opens separate windows for:

- `npm run dev`
  - app server
- `npm run party:dev`
  - PartyKit dev server
- `npm run trigger:dev`
  - Trigger.dev local dev tunnel

This means the script already acts as the main auto-launch helper for local work.

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

### What counts as testing in this repo today

The main checked-in validation/test flow right now is:

- `scripts\site-check.bat`
  - runs Svelte/TypeScript validation
- `scripts\site-dev.bat`
  - launches the local services needed for manual testing
- the smoke-test playbooks later in this README

There is not yet a full end-to-end automated browser test suite. Right now, the repo relies on validation plus manual smoke testing.

### Safe save flow

From the repo root:

```bat
scripts\site-save.bat --message "describe your change"
```

This is the preferred replacement for manually running git stage + commit commands.

### Safe ship flow

From the repo root:

```bat
scripts\site-ship.bat --message "describe your change"
```

This is the preferred replacement for the usual human sequence of:

- validate
- git add
- git commit
- git push
- remember whether PartyKit also needs deployment

Useful flags:

```bat
scripts\site-ship.bat --skip-check
scripts\site-ship.bat --skip-party-deploy
scripts\site-ship.bat --force-party-deploy
scripts\site-ship.bat --help
```

### Safe status flow

From the repo root:

```bat
scripts\site-status.bat
```

Use this when you want a simple answer to:

- what branch am I on?
- do I have unsaved work?
- do I have unpushed commits?
- do my current changes probably require a PartyKit deploy?

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

Expected local meanings from `site/.env.example`:

- `TURSO_URL`
  - Turso database URL
- `TURSO_AUTH_TOKEN`
  - Turso access token
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
  - Google auth configuration
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`
  - Discord auth configuration
- `OPENAI_API_KEY`
  - required for GM responses
- `OPENAI_MODEL`, `OPENAI_MODEL_INTERACTIVE`, `OPENAI_MODEL_BACKGROUND`
  - OpenAI model selection
- `AI_INTERACTIVE_MODE`
  - interactive AI route mode; usually `inline`
- `ENABLE_DEV_AUTH`
  - local/dev auth convenience; never set true in production
- `TRIGGER_SECRET_KEY`
  - local Trigger.dev secret, typically `tr_dev_...`
- `PUBLIC_PARTYKIT_HOST`, `PARTYKIT_HOST`
  - PartyKit host split for browser/server use

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

## Common operator tasks: exact handling

This section is intended to be copy-followable by an agent guiding a non-technical cooperator.

### Task: start local work from zero

1. clone the repo
2. install `site/` dependencies
3. create `site/.env`
4. run `scripts\site-status.bat`
5. run `scripts\site-dev.bat`
6. open `http://localhost:5173`

### Task: edit normal UI or route code

Examples:

- Svelte pages/components
- server routes
- non-PartyKit app logic

Flow:

1. `scripts\site-dev.bat`
2. edit the code
3. test in `http://localhost:5173`
4. `scripts\site-check.bat`
5. `scripts\site-save.bat --message "describe your change"`
6. `scripts\site-ship.bat`

Deploy consequence:

- Vercel should update on push to `main`
- PartyKit deploy usually not needed unless PartyKit files changed

### Task: edit PartyKit realtime behavior

Examples:

- `site/party/server.ts`
- `site/partykit.json`

Flow:

1. `scripts\site-dev.bat --party`
2. if also testing the whole app, run `scripts\site-dev.bat --app`
3. test through the app at `http://localhost:5173`
4. `scripts\site-check.bat`
5. `scripts\site-save.bat --message "describe your change"`
6. `scripts\site-ship.bat`

Deploy consequence:

- PartyKit must be deployed for production behavior to change
- `site-ship` will try to detect this automatically

### Task: edit Trigger.dev jobs or background AI flow

Examples:

- `site/src/trigger/`
- `site/trigger.config.ts`
- shared AI code used by Trigger tasks

Flow:

1. `scripts\site-dev.bat --trigger`
2. if also testing the app path, run `scripts\site-dev.bat --app`
3. complete any Trigger.dev login prompts if needed
4. test the relevant feature
5. `scripts\site-check.bat`
6. `scripts\site-save.bat --message "describe your change"`
7. `scripts\site-ship.bat`

Deploy consequence:

- Trigger.dev production deployment is handled by GitHub Actions on push to `main`

### Task: save work without shipping yet

Use:

```bat
scripts\site-save.bat --message "describe your change"
```

This validates, stages all changes, and creates a commit.

### Task: ship work to production

Use:

```bat
scripts\site-ship.bat --message "describe your change"
```

This is the main safe push/deploy wrapper for routine use.

### Task: just inspect what is going on

Use:

```bat
scripts\site-status.bat
```

This is the best first command when the operator is unsure what state the repo is in.

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

### 4b. Trigger.dev login / setup prompts during `trigger dev`

Common prompts include:

- asking whether to install Trigger.dev code agent rules
  - safe default here: `No`
- asking you to login in the browser
  - normal on a fresh machine
- warning that Trigger packages should be pinned to the exact CLI version
  - safe default here: `Yes`

If the CLI offers to pin `@trigger.dev/sdk` and `@trigger.dev/build` to the exact installed version, accept the update and then save the resulting `site/package.json` / lockfile changes.

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
scripts\site-status.bat
scripts\site-dev.bat
scripts\site-check.bat
scripts\site-save.bat --message "describe your change"
```

### Release safely

```bat
scripts\site-ship.bat --message "describe your change"
```

### When in doubt

1. go to repo root
2. use `scripts\*.bat`
3. treat PartyKit deploy as manual unless the script already handled it
4. verify Vercel + GitHub Action after push

That is the intended operating model for this repository.
