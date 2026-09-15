import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GmailAgent, loadAgentConfig } from "../src/agent.ts";
import { Store } from "../src/db.ts";
import { GmailMcpConnection } from "../src/gmail-mcp.ts";

let source = "";
for await (const chunk of process.stdin) source += chunk;

const invocation = JSON.parse(source);
const endpoint = process.env.GMAIL_MCP_URL;
if (!endpoint || !process.env.ANTHROPIC_API_KEY) {
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    status: "failed",
    error: {
      schemaVersion: 1,
      code: "target.CONFIGURATION_MISSING",
      source: "target",
      message: "This example needs ANTHROPIC_API_KEY and the Firedrill MCP binding.",
      retryable: false,
      issues: [],
    },
  }));
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "firedrill-gmail-example-"));
const store = new Store(join(scratch, "agent.sqlite"));
try {
  const gmail = new GmailMcpConnection(endpoint, process.env.GMAIL_MCP_TOKEN);
  const agent = new GmailAgent(
    loadAgentConfig({ ...process.env, AGENT_MAX_TURNS: "12" }, scratch),
    store,
    gmail,
  );
  const conversation = store.createConversation();
  const errors = [];
  await agent.runTurn(conversation.id, invocation.instruction, (event) => {
    if (event.type === "error") errors.push(event.message);
  });
  if (errors.length > 0) {
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      status: "failed",
      error: {
        schemaVersion: 1,
        code: "target.AGENT_FAILED",
        source: "target",
        message: "The Gmail Agent did not complete this turn. See the local execution report.",
        retryable: false,
        issues: [],
      },
    }));
  } else {
    const actions = store.listActions(conversation.id);
    const reply = store.listMessages(conversation.id).filter((message) => message.role === "assistant").at(-1)?.content ?? "";
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      status: "completed",
      output: {
        reply: reply.slice(0, 4000),
        actionCount: actions.length,
        toolNames: actions.map((action) => action.tool),
      },
    }));
  }
} finally {
  store.close();
  rmSync(scratch, { recursive: true, force: true });
}
