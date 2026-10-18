# Public example agent

This repository is a customer-side example for Firedrill. Preserve its Apache-2.0
license and history. The agent runs locally or in the customer's CI; synthetic
Tools run in Firedrill. Do not embed a Tool implementation or private engine.

Use the official `@firedrill-run/sdk` and `@firedrill-run/cli` clients, pinned
to the coordinated 2.1.0 release. Exact public release archives are supported
while registry publication is pending; never substitute a private/local checkout.
The retired cloud client is not supported.
Keep source definitions separate
from the runner command. MCP URLs and credentials are issued for a specific
case or environment, never constants. Do not load real Gmail credentials.

Do not run provider-backed agents or drills merely to check formatting or build
changes. `npm run check` is offline. Live execution requires the operator's
explicit choice and their own account and model credentials. Never commit local
credentials, conversations, captures, or `.firedrill` recovery files.

Before publishing changes, run `npm ci`, `npm run check`, and the secret-history
scan. A completed model process is not evidence that a Firedrill check passed.
