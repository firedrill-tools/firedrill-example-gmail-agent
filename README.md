# Gmail Agent × Firedrill

A real Claude Agent SDK email assistant, connected over MCP to synthetic Gmail
in Firedrill. The same agent and SQLite conversation store run locally and in
your CI. No real Gmail account or Google credentials are used.

## Start with the CLI

Use Node 24 and your own Anthropic API key. Install the pinned clients and sign
in to select a Firedrill project and its environment:

```sh
npm ci
npx --no-install firedrill init
npm run firedrill:prepare
```

This branch pins the official Firedrill 2.1.0 npm clients in
`package.json` and their integrity in `package-lock.json`. They install like
ordinary npm dependencies; no private source checkout or Firedrill runtime is
required. Exact versions keep local and CI execution on the same release.

Preparation acquires the current catalog Gmail release with synthetic starter
data, saves its exact project-owned build/dataset IDs, and writes two recipes
under ignored `.firedrill/`. It does **not** call a model or run the agent.
Your account, connection credentials and recovery state are never committed.

Supply `ANTHROPIC_API_KEY` through your shell or secret manager, then run:

```sh
npx --no-install firedrill simulate .firedrill/recipe.pass.json
```

Or execute the same recipe through the TypeScript SDK:

```sh
npm run simulate
```

The two cases ask the actual agent to list inbox messages and unread messages.
Every case receives a separate seeded Gmail instance, a fresh local conversation
database and a read-only MCP grant for `messages.list`. Firedrill checks actual
service-recorded calls and successful outcomes; the agent's wording need not
match a fixed answer. The result links to the authenticated web report.

The normal recipe has **2 cases**, expected to pass when the agent successfully
lists mail. That is a target expectation, not a claim that an unexecuted run
passed. Model/tool failures remain visible. These API/MCP cases do not fabricate
screenshots; their evidence is the real Tool activity, outputs and checks.

## Demonstrate a genuine failed gate

```sh
npx --no-install firedrill simulate .firedrill/recipe.deliberate-failure.json
```

This still runs the real agent on the same tasks. One check deliberately expects
**zero** Gmail list calls even though the task asks the agent to list mail.
If both tasks run successfully, the report should contain **1 passed case and
1 failed case**, with exit `1`. This is a labelled negative control proving that
the CI gate catches a wrong expectation—not a fabricated agent defect.

Preparation keeps a durable catalog-acquisition intent. If interrupted, repeat
`npm run firedrill:prepare` without deleting that intent. For an interrupted
simulation, follow the printed `firedrill simulate --resume OPERATION_ID` command.
For the SDK runner, use `npm run simulate -- --resume OPERATION_ID`. Resume
reconciles saved work; starting a new command is a new simulation.

## Run on pull requests

This repository already includes `.github/workflows/firedrill.yml`. Configure
the protected GitHub environment **firedrill-ci**:

- Secrets: `FIREDRILL_TOKEN` (project/environment-scoped machine credential) and
  `ANTHROPIC_API_KEY` (your agent's model key).
- Variables: `FIREDRILL_PROJECT_ID`, `FIREDRILL_ENVIRONMENT_ID`,
  `FIREDRILL_GMAIL_BUILD_ID`, `FIREDRILL_GMAIL_DATASET_ID`, using preparation's
  returned IDs. Set `FIREDRILL_CI_ENABLED=true` to enable trusted pushes/PRs.
- Install/select the Firedrill CI GitHub App for your repository. Keep review
  protection for code changes before exposing credentials.

Manual dispatch is available independently. Choose `pass` for ordinary checks
or `deliberate-failure` for the labelled negative control. Fork PRs never receive
these credentials; no `pull_request_target` execution is used.

The final step publishes a simulation check and updates a compact PR comment
with real counts and the detailed Firedrill report link. An SDK script's zero
exit cannot hide a blocked gate. A runner failure remains failed even when
report delivery succeeds. Retained results and reporting status remain separate.

When adding simulations to a different application repository, generate its
workflow after preparing its own recipe:

```sh
firedrill ci init PATH_TO_RECIPE.json --trigger pull_request --trigger manual --github-app
```

The installed CLI pins its own exact version. Do not overwrite this example's
existing workflow with a second generated copy. Reporting retries use
`firedrill ci report BATCH_ID` inside an authorized workflow; they do not rerun
the agent. `firedrill ci connections` shows the verified repository/workflow
connection after its first authorized report.

## Optional local chat UI

`npm start` serves the actual chat application on `http://127.0.0.1:4310`.
For manual use, create a persistent synthetic Gmail instance using
`firedrill tools start`, then issue its MCP grant with
`firedrill tools connections create`. Set its instance-specific MCP URL/token
as `GMAIL_MCP_URL`/`GMAIL_MCP_TOKEN` in ignored `.env`, together with your model
key. Never use a real Gmail endpoint or copy a manual connection into a recipe.

The default autonomy is read-only. Browser Tool views and history are available
from that instance in the Firedrill portal; the case-owned temporary instances
used by simulations close separately and retain their recorded history.

## Key files

- `src/agent.ts`, `src/db.ts`, `src/gmail-mcp.ts`: the actual application.
- `test/run-agent.mjs`: customer-owned command adapter; only case MCP authority.
- `firedrill/scenarios.json`: authored tasks and evidence-backed checks.
- `firedrill/recipe.template.json`: execution, isolation and gate configuration.
- `firedrill/prepare.mjs`: authenticated, recoverable catalog/dataset preparation.
- `firedrill/run.mjs`: SDK execution with the same CLI exit convention.
- `.github/workflows/firedrill.yml`: PR/push/manual simulation and App reporting.

`npm run check` is offline: typecheck, build and adapter checks, with no model
or Firedrill calls. Local SQLite stores the agent's conversations, not the cloud
mailbox. Keep the single-user chat server on loopback.

[Documentation](https://docs.firedrill.run) ·
[CI and pull requests](https://docs.firedrill.run/guides/pull-request-ci)

Apache-2.0. Copyright Reload Tech Inc.
