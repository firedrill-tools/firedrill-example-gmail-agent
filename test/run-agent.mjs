import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GmailAgent, loadAgentConfig } from "../src/agent.ts";
import { Store } from "../src/db.ts";
import { GmailMcpConnection } from "../src/gmail-mcp.ts";

const failed = (code, message) => ({
  schemaVersion: 1, status: "failed", attachments: [],
  error: { schemaVersion: 1, code: `target.${code}`, source: "target", message, retryable: false, issues: [] },
});
let scratch;
let store;
const abort = new AbortController();
const stop = () => abort.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const timeout = setTimeout(stop, 110_000);
timeout.unref();
let result;
try {
  let source = "";
  for await (const chunk of process.stdin) {
    source += chunk;
    if (Buffer.byteLength(source) > 100_000) throw new Error("INVOCATION_TOO_LARGE");
  }
  const invocation = JSON.parse(source);
  if (!invocation || invocation.schemaVersion !== 1 ||
      typeof invocation.instruction !== "string" || !invocation.instruction.trim() ||
      invocation.instruction.length > 20_000) throw new Error("INVALID_INVOCATION");
  const endpoint = process.env.GMAIL_MCP_URL;
  const token = process.env.GMAIL_MCP_TOKEN;
  if (!endpoint || !token || !process.env.ANTHROPIC_API_KEY) {
    result = failed("CONFIGURATION_MISSING", "Set ANTHROPIC_API_KEY and use the case-scoped Firedrill MCP binding.");
  } else {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.hostname !== "world.firedrill.run" ||
        url.port || url.username || url.password || url.hash || url.search) {
      throw new Error("INVALID_BINDING");
    }
    scratch = mkdtempSync(join(tmpdir(), "firedrill-gmail-example-"));
    store = new Store(join(scratch, "agent.sqlite"));
    const agent = new GmailAgent(
      loadAgentConfig({ ...process.env, AGENT_MAX_TURNS: "12", AGENT_AUTONOMY: "read" }, scratch),
      store, new GmailMcpConnection(endpoint, token),
    );
    const conversation = store.createConversation();
    let completed = false;
    let errored = false;
    let metrics;
    await agent.runTurn(conversation.id, invocation.instruction, (event) => {
      if (event.type === "error") errored = true;
      if (event.type === "done") {
        completed = true;
        metrics = { costUsd: event.costUsd, turns: event.turns, durationMs: event.durationMs };
      }
      if (event.type === "approval_required") agent.resolveApproval(event.approvalId, "deny");
    }, abort.signal);
    if (abort.signal.aborted || errored || !completed) {
      result = failed("AGENT_FAILED", "The agent did not complete this task; no success is implied.");
    } else {
      const actions = store.listActions(conversation.id);
      const reply = store.listMessages(conversation.id).filter(message => message.role === "assistant").at(-1)?.content ?? "";
      result = { schemaVersion: 1, status: "completed", attachments: [], output: {
        reply: reply.slice(0, 4000), actionCount: actions.length,
        toolNames: actions.map(action => action.tool), ...metrics,
      } };
    }
  }
} catch {
  result = failed("ADAPTER_FAILED", "Invalid invocation, invalid Tool binding, or agent execution failure.");
} finally {
  clearTimeout(timeout);
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  store?.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(result)}\n`);
