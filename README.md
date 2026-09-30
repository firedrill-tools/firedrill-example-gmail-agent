# Gmail Agent — internal Firedrill CI fixture

This private repository retains a customer-owned Claude Agent SDK email assistant and its behavioral tests. It is an internal integration fixture, not a supported quickstart. Firedrill runs the synthetic Gmail Tool and evaluates recorded effects; the GitHub runner executes the agent. No local Firedrill runtime or real Gmail account is involved.

The managed CI candidate uses the existing `test/run-agent.mjs` adapter without changing `src/` or `web/src/`. The adapter reads a single invocation from standard input, uses the invocation-scoped MCP endpoint, and writes one result to standard output. `ANTHROPIC_API_KEY` stays in the runner; Firedrill supplies only synthetic Tool access.

## Connect this repository before a PR run

An authorized project owner must install and claim the Firedrill GitHub App for **only this repository**, connect the repository and `firedrill.json` source root to the intended project and environment, and select a current reviewed Gmail Tool artifact. The CLI does not install the App or create the repository binding. See the [pull-request CI guide](https://docs.firedrill.run/guides/pull-request-ci).

Set these GitHub Actions variables from the connected resource identities:

- `FIREDRILL_PROJECT_ID`
- `FIREDRILL_ENVIRONMENT_ID`
- `FIREDRILL_REPOSITORY_BINDING_ID`

Set `ANTHROPIC_API_KEY` as a GitHub Actions secret for the agent. Do not add a long-lived Firedrill credential: the workflow requests short-lived authority using GitHub OIDC. Pull requests from forks skip the managed drill job because they cannot safely receive the provider secret.

The workflow checks out the exact PR head (or push) commit, installs Node.js 24 and the pinned `@firedrill-run/cloud@0.1.13` / `@firedrill-run/ci-client@0.1.0` clients, checks the example application, then invokes `firedrill ci run --auth github`. The `default` suite selects `find-invoice`, a read-only task whose checks require an actual Gmail Tool read and prohibit sending. This is a head-revision gate, not a base-versus-head comparison; a comparison would require separately running both authorized revisions. The first PR cannot use the older base revision as a suite baseline because that revision has no managed suite.

Locally, `npm ci`, `npm run check`, and `npx firedrill ci --help` are non-agent preparation checks. They do not establish a passing hosted test. A positive PR gate requires the App connection, exact build admission, a same-repository PR run, the provider key, and retained Results evidence. Do not run the agent or a model call merely to validate this repository's wiring.

## Repository layout

- `src/` and `web/src/`: customer-owned agent and optional chat UI, unchanged by the CI migration.
- `test/run-agent.mjs`: the existing non-interactive agent adapter.
- `firedrill/world.json`, `firedrill/scenarios/`, `firedrill/drills/`, `firedrill/targets/`: synthetic data, tasks, checks, and binding declaration.
- `firedrill/suites/default.suite.json`: the selected PR check.
- `firedrill.json`: source root and pinned Gmail Tool package.

The example does not call the real Gmail API. Keep `.env`, `data/`, and `.firedrill/` out of Git. Apache-2.0; copyright Reload Tech Inc.
