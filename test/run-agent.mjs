import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GmailAgent, loadAgentConfig } from "../src/agent.ts";
import { Store } from "../src/db.ts";
import { GmailMcpConnection } from "../src/gmail-mcp.ts";

// The real application adapter receives only its run-owned Gmail connection,
// not the operator credential, CI identity or hidden expected answers.
let scratch, store, failure, output;
const abort = new AbortController(), stop = () => abort.abort();
process.once("SIGINT", stop); process.once("SIGTERM", stop);
const timer = setTimeout(stop, 150_000); timer.unref();
try {
  let source = "";
  for await (const chunk of process.stdin) {
    source += chunk;
    if (Buffer.byteLength(source) > 100_000) throw new Error("INVOCATION_TOO_LARGE");
  }
  const invocation = JSON.parse(source);
  if (invocation?.schemaVersion !== "2026-10-17-target-invocation.1" || typeof invocation.input?.instruction !== "string" ||
      !invocation.input.instruction.trim() || invocation.input.instruction.length > 20_000 ||
      typeof invocation.runId !== "string" || typeof invocation.attemptId !== "string") throw new Error("INVALID_INVOCATION");
  const binding = invocation.tools?.gmail, connection = binding?.connections?.mcp;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("MODEL_CREDENTIAL_MISSING");
  if (!connection || typeof connection.token !== "string" || !/^fdsc_[A-Za-z0-9_-]{43}$/.test(connection.token)) throw new Error("CASE_BINDING_MISSING");
  const url = new URL(connection.url);
  if (url.origin !== "https://api.firedrill.run" || url.username || url.password || url.hash ||
      url.pathname !== `/v1/service-instances/${binding.instanceId}/mcp` ||
      [...url.searchParams.keys()].some(key => !["projectId", "environmentId"].includes(key)) ||
      !["projectId", "environmentId"].every(key => url.searchParams.getAll(key).length === 1 && /^[A-Za-z0-9_-]{1,160}$/.test(url.searchParams.get(key))) ||
      !Array.isArray(binding.operations) || binding.operations.length !== 1 || binding.operations[0] !== "messages.list") throw new Error("INVALID_BINDING");
  scratch = mkdtempSync(join(tmpdir(), "firedrill-gmail-case-"));
  store = new Store(join(scratch, "agent.sqlite"));
  const agent = new GmailAgent(loadAgentConfig({ ...process.env, AGENT_MAX_TURNS: "12", AGENT_AUTONOMY: "read" }, scratch), store,
    new GmailMcpConnection(connection.url, connection.token));
  const conversation = store.createConversation();
  let completed = false, errored = false, metrics;
  await agent.runTurn(conversation.id, invocation.input.instruction, event => {
    if (event.type === "error") errored = true;
    if (event.type === "done") { completed = true; metrics = { costUsd: event.costUsd, turns: event.turns, durationMs: event.durationMs }; }
    if (event.type === "approval_required") agent.resolveApproval(event.approvalId, "deny");
  }, abort.signal);
  if (abort.signal.aborted || errored || !completed) throw new Error("AGENT_DID_NOT_COMPLETE");
  const actions = store.listActions(conversation.id), reply = store.listMessages(conversation.id).filter(message => message.role === "assistant").at(-1)?.content ?? "";
  output = { reply: reply.slice(0, 4000), replyCharacters: reply.length, actionCount: actions.length,
    toolNames: actions.map(action => action.tool), ...metrics };
} catch (error) {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "AGENT_ADAPTER_FAILED";
  failure = { error: { code, message: "The real agent did not complete. No success or passing assessment is implied." } };
} finally {
  clearTimeout(timer); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  store?.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
if (failure) { process.stderr.write(JSON.stringify(failure) + "\n"); process.exitCode = 3; }
else process.stdout.write(JSON.stringify(output) + "\n");
