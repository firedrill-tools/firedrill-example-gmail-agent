# Gmail Agent × Firedrill

A small email assistant built with the Claude Agent SDK and a React + Vite chat
UI. Run the agent on your machine, connect it to a synthetic Gmail mailbox in
Firedrill, and check the Tool calls it actually makes.

[Firedrill docs](https://docs.firedrill.run) ·
[Example walkthrough](https://docs.firedrill.run/guides/example-agents)

## Requirements

- Node.js 20.19+ and npm.
- A Firedrill account for synthetic Tools and saved results.
- Your Anthropic API key for this example agent. Agent execution incurs model
  usage in your Anthropic account; Firedrill does not supply that key.

```sh
git clone https://github.com/firedrill-tools/firedrill-example-gmail-agent.git
cd firedrill-example-gmail-agent
npm ci
npm run check
npx firedrill init
```

During `init`, choose your project, **Gmail**, **starter data**, and a persistent
connection. Keep the printed setup and environment IDs. Tools run in Firedrill;
this repository contains the agent, its UI, and test-side adapters—not a Tool
server or Firedrill runtime.

## Use the chat UI

Copy `.env.example` to an ignored local `.env`, and set `ANTHROPIC_API_KEY`.
Obtain the connection values for **your** ready environment:

```sh
npx firedrill connect --environment YOUR_ENVIRONMENT_ID --actor local-dev --format env
```

Replace the environment ID with the value from your setup. Put the issued
`FIREDRILL_MCP_URL` and `FIREDRILL_MCP_TOKEN` values into `.env` as
`GMAIL_MCP_URL` and `GMAIL_MCP_TOKEN`. These are short-lived secrets; do not commit
them or paste them into an issue. If your setup uses another acting identity,
select that actor instead of `local-dev`.

```sh
npm start
```

Open http://127.0.0.1:4310 and ask: “List my inbox and summarize one message.
Don't change anything.” The activity panel shows this agent's actual Tool
calls. Open the Gmail app from your Firedrill Tool instance to inspect the same
synthetic records. There is no real Gmail connection in this example.

`AGENT_AUTONOMY=read` is the safe default in the supplied environment template.
Changing it to `write` allows writes without asking; `all` additionally allows
deletion. Keep `read` while learning. `npm run dev` starts the hot-reload UI at
http://127.0.0.1:4311.

If compute pauses, resume your environment. If the connection expires, run
`firedrill connect` again and restart this agent with the new values. Neither
action resets Tool data. See [connections and lifetimes](https://docs.firedrill.run/guides/install-tools).

## Run the saved test

The committed `firedrill.tests.json` defines a read-only mailbox task and checks
for a successful message-list call. The actor cannot send or modify mail.
`test/run-agent.mjs` invokes the same agent with a fresh local conversation for
each case; it does not manufacture a reply or a passing verdict.

Save these definitions against the setup you just created:

```sh
npx firedrill tools add --from-setup YOUR_ORIGINAL_SETUP_ID --tests firedrill.tests.json --wait
```

This creates a **new** ready setup. Use its ID below, not the original setup's
ID. Provide `ANTHROPIC_API_KEY` in the terminal through your normal secret
manager; `.env` is for the chat server, and the test adapter does not load it.

```sh
npm run drills -- --setup YOUR_NEW_TEST_SETUP_ID
```

Each case receives its own scoped MCP connection and isolated Tool state. The
CLI maps that connection to the variables the agent already reads using
`bindingEnvironment` in `firedrill.config.json`. The model key stays in your
runner. Firedrill evaluates the observed Tool calls and saves the tests, run,
simulation, and evidence. Open the result URL printed by the CLI.

An agent finishing is not a passing test: failure to list messages fails the
check. An API/MCP-only run does not automatically produce screenshots. See
[capture](https://docs.firedrill.run/guides/capture) for browser evidence.

To run more cases, add seeds, repetitions and concurrency to the config using
the [simulation guide](https://docs.firedrill.run/guides/simulations). These are
independent cases, not necessarily different scenarios. Follow the CLI's
recovery command after an interruption rather than starting duplicate work.

## Run in GitHub Actions

The ordinary CI workflow builds and checks this example without calling a
model or Firedrill. The separate **Firedrill drills** workflow is opt-in:

1. Fork or clone the repository into your own GitHub repository.
2. Set repository variables `FIREDRILL_PROJECT_ID` and
   `FIREDRILL_TEST_SETUP_ID` to your project and the new saved-test setup.
3. Set secrets `FIREDRILL_CREDENTIAL` (a project-scoped service credential) and
   `ANTHROPIC_API_KEY`.
4. Run **Firedrill drills** manually. To also run on trusted pushes and
   same-repository pull requests, set `FIREDRILL_DRILLS_ENABLED=true`.

Fork pull requests do not receive these secrets or run drills. Review code
before enabling provider-backed execution for people with repository write
access. No GitHub App is required for this direct CLI workflow. For revision
comparison and the Firedrill PR integration, see
[PR CI](https://docs.firedrill.run/guides/pull-request-ci).

## Layout

```text
src/                       Agent, local API server and conversation/action store
web/src/                   React chat UI
test/run-agent.mjs         Customer-side command adapter
firedrill.tests.json        Saved task, actor permissions and world checks
firedrill.config.json       Local executable and scoped binding mapping
.github/workflows/          Offline checks and opt-in real drills
```

Local SQLite stores this agent's conversations, not Firedrill's mailbox.
`.env`, `data/`, and `.firedrill/` are ignored. The UI is a single-user local
example, not a multi-tenant server; keep it bound to loopback.

Apache-2.0. Copyright Reload Tech Inc.
