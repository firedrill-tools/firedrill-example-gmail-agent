import "dotenv/config";
import express, { type Request, type Response } from "express";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Store } from "./db.js";
import { GmailAgent, loadAgentConfig, type AgentEvent } from "./agent.js";
import { GmailMcpConnection } from "./gmail-mcp.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dataDir = join(root, "data");
const workDir = join(dataDir, "agent-work");
mkdirSync(workDir, { recursive: true });

for (const name of ["ANTHROPIC_API_KEY", "GMAIL_MCP_URL"]) {
  if (!process.env[name]) {
    console.error(`${name} is not set. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const port = Number(process.env.PORT ?? 4310);
const config = loadAgentConfig(process.env, workDir);
const store = new Store(join(dataDir, "gmail-agent.sqlite"));
const gmail = new GmailMcpConnection(process.env.GMAIL_MCP_URL!, process.env.GMAIL_MCP_TOKEN || undefined);
const agent = new GmailAgent(config, store, gmail);

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(join(root, "web", "dist")));

// ---- status ---------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: config.model, autonomy: config.autonomy, maxTurns: config.maxTurns, gmail: "mcp" });
});

// ---- synthetic Gmail connection -------------------------------------------

app.get("/api/gmail/status", async (_req, res) => {
  try {
    res.json(await gmail.status());
  } catch (error) {
    res.status(502).json({ connected: false, summary: `Gmail MCP unreachable: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// ---- conversations --------------------------------------------------------

app.get("/api/conversations", (_req, res) => {
  res.json(store.listConversations());
});

app.post("/api/conversations", (req, res) => {
  const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : undefined;
  res.status(201).json(store.createConversation(title));
});

app.get("/api/conversations/:id", (req, res) => {
  const conversation = store.getConversation(String(req.params.id));
  if (!conversation) return res.status(404).json({ error: "conversation not found" });
  res.json({
    conversation,
    messages: store.listMessages(conversation.id),
    actions: store.listActions(conversation.id).reverse(),
    pendingApprovals: agent.listPendingApprovals(conversation.id).map(({ resolve: _r, ...p }) => p),
  });
});

app.delete("/api/conversations/:id", (req, res) => {
  res.json({ deleted: store.deleteConversation(String(req.params.id)) });
});

// ---- chat: one user turn, streamed back as server-sent events --------------

app.post("/api/conversations/:id/messages", async (req: Request, res: Response) => {
  const conversation = store.getConversation(String(req.params.id));
  if (!conversation) return res.status(404).json({ error: "conversation not found" });
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: AgentEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  // Abort the agent only if the client actually goes away mid-stream. (`req` emits
  // "close" as soon as the request body is consumed, which would abort every turn.)
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);

  try {
    await agent.runTurn(conversation.id, text, send, abort.signal);
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

// ---- human-in-the-loop approvals -----------------------------------------

app.get("/api/approvals", (_req, res) => {
  res.json(agent.listPendingApprovals().map(({ resolve: _r, ...p }) => p));
});

app.post("/api/approvals/:id", (req, res) => {
  const decision = req.body?.decision;
  if (decision !== "allow" && decision !== "deny") return res.status(400).json({ error: "decision must be allow or deny" });
  const ok = agent.resolveApproval(String(req.params.id), decision);
  if (!ok) return res.status(404).json({ error: "no pending approval with that id" });
  res.json({ ok: true, decision });
});

// ---- the action log: everything the agent did in Gmail --------------------

app.get("/api/actions", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  res.json(store.listActions(undefined, limit));
});

// ---------------------------------------------------------------------------

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Gmail agent ready — http://127.0.0.1:${port}`);
  console.log(`Model ${config.model} · autonomy ${config.autonomy} · Gmail via MCP`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    store.close();
    process.exit(0);
  });
}
