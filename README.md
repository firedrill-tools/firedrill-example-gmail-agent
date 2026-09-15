# Gmail Agent example

A small email assistant built with the Claude Agent SDK. Firedrill gives it a
stateful synthetic Gmail mailbox over MCP, then checks what the agent actually
read or changed. The agent uses ordinary MCP configuration; it does not import
Firedrill.

## Run the drills

Clone this repo beside the [Firedrill framework](https://github.com/firedrill-tools/firedrill):

```text
repositories/
  firedrill/
  firedrill-example-gmail-agent/
```

Node.js 20.19+ is required. Until the framework CLI is published, build its
checkout first:

```sh
cd ../firedrill
pnpm install --frozen-lockfile
pnpm build

cd ../firedrill-example-gmail-agent
npm ci
```

Provide `ANTHROPIC_API_KEY` to this terminal using your normal secret manager.
The CLI passes that one host variable to the agent process; it never writes the
key to Firedrill source. Then:

```sh
npm run typecheck
npm run drills -- find-invoice
npm run drills -- send-note
npm run drills -- send-rate-limited
```

Use `npm run drills` to run all three. Each run gets a fresh synthetic world and
saves an HTML report under `.firedrill/reports/`. Open
`.firedrill/reports/index.html` for the full report list. A failed assertion
exits with code 1.

The invoice drill checks that the agent finds and reads mail without sending
anything. The note drill checks one successful send. The rate-limit drill
checks that a rejected send changes no delivery state; its response text is
visible in the report but is not text-graded.

## Browse the synthetic mailbox

Run the local Tool and inspector in the foreground:

```sh
node ../firedrill/packages/cli/dist/bin.js serve
```

Open the **Gmail** Tool app from the inspector. Its browser UI and MCP/HTTP
operations share the same synthetic SQLite-backed state. To use this repo's
standalone chat UI, copy the local MCP URL and token from **Connect agent** into
a local `.env` based on [`.env.example`](.env.example), then run `npm start`
in a second terminal and open `http://127.0.0.1:4310`. This app only accepts
the configured MCP endpoint; it has no connection to a real Gmail account.

## Where things live

```text
src/                         Claude Agent SDK agent, chat server, local action log
public/                      Standalone chat interface
test/run-agent.mjs            Test-side adapter: one MCP endpoint + model key
firedrill/world.json          Synthetic mailboxes, seed messages, actor access
firedrill/scenarios/          Baseline and send-failure setup
firedrill/drills/             Tasks and behavioral assertions
firedrill/targets/            Agent subprocess and credential mapping
.firedrill-tools/             Pinned Gmail Tool package
.firedrill/                   Generated worlds, reports, and evidence (ignored)
```

The reusable Gmail Tool's operation definitions, behavior, HTTP/MCP endpoints,
and browser UI live in its independently owned
[package](https://github.com/firedrill-tools/firedrill-community-tools/tree/main/packages/gmail).
This project owns only its test data and drills; it does not copy or modify Tool
behavior. The optional chat server's SQLite file under `data/` is its own action
log, separate from Firedrill's synthetic mailbox database.

## Safety

The example does not call the real Gmail API. The Tool package is trusted local
test code, not a sandbox. Review packages before executing them, and keep
`.env`, `data/`, and `.firedrill/` out of Git.

Apache-2.0. Copyright Reload Tech Inc.
