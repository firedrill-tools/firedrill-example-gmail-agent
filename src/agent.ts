import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import type { ActionCategory, Store } from "./db.js";
import type { GmailMcpConnection } from "./gmail-mcp.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type Autonomy = "read" | "write" | "all";

export interface AgentConfig {
  model: string;
  maxTurns: number;
  autonomy: Autonomy;
  workDir: string;
}

export function loadAgentConfig(env: NodeJS.ProcessEnv, workDir: string): AgentConfig {
  const autonomy = (env.AGENT_AUTONOMY ?? "write") as Autonomy;
  if (!["read", "write", "all"].includes(autonomy)) throw new Error(`AGENT_AUTONOMY must be read, write or all (got ${autonomy})`);
  return {
    model: env.AGENT_MODEL ?? "claude-sonnet-4-5",
    maxTurns: Number(env.AGENT_MAX_TURNS ?? 30),
    autonomy,
    workDir,
  };
}

// ---------------------------------------------------------------------------
// Classifying what a call DOES to the mailbox.
//
// This example accepts the ordinary Gmail MCP operation names. Unknown operations
// are denied rather than guessed safe. This is an agent policy, not a Firedrill rule.
// ---------------------------------------------------------------------------

export function gmailToolName(fullName: string): string | null {
  const m = /^mcp__gmail__(.+)$/.exec(fullName);
  return m ? m[1] : null;
}

/** Returns the category, or null when the call must be denied. */
export function classify(fullName: string, _input: Record<string, unknown> = {}): ActionCategory | null {
  const name = gmailToolName(fullName);
  if (!name) return null;
  const n = name.toUpperCase().replace(/^GMAIL_/, "");
  const parts = n.split("_");
  const verb = parts.at(-1) === "MODIFY" || parts.at(-1) === "LIST" || parts.at(-1) === "GET" || parts.at(-1) === "SEND"
    ? parts.at(-1)!
    : parts[0]!;
  if (["DELETE", "TRASH", "BATCH_DELETE"].includes(verb)) return "delete";
  if (["SEND", "REPLY", "FORWARD", "CREATE", "UPDATE", "LABEL", "UNLABEL", "MODIFY", "MARK", "MOVE", "ARCHIVE", "UNTRASH", "APPLY"].includes(verb)) return "write";
  if (["GET", "LIST", "SEARCH", "READ", "FETCH"].includes(verb)) return "read";
  return null;
}

function allowedWithoutAsking(category: ActionCategory, autonomy: Autonomy): boolean {
  if (category === "read") return true;
  if (category === "write") return autonomy !== "read";
  if (category === "delete") return autonomy === "all";
  return false;
}

// ---------------------------------------------------------------------------
// Events streamed to the UI
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: "session"; sdkSessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "text_done"; text: string }
  | { type: "tool_call"; toolUseId: string; tool: string; category: ActionCategory; input: unknown; approval: "auto" | "user" }
  | { type: "tool_result"; toolUseId: string; output: unknown; isError: boolean }
  | { type: "approval_required"; approvalId: string; toolUseId: string; tool: string; category: ActionCategory; input: unknown }
  | { type: "approval_resolved"; approvalId: string; decision: "allow" | "deny" }
  | { type: "done"; costUsd: number; turns: number; durationMs: number; stopReason: string | null }
  | { type: "error"; message: string };

export interface PendingApproval {
  id: string;
  conversationId: string;
  toolUseId: string;
  tool: string;
  category: ActionCategory;
  input: unknown;
  resolve: (decision: "allow" | "deny") => void;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a careful, capable email assistant with access to the user's Gmail through tools.

What you can do: search and read email, summarise threads, organise the inbox (labels, archive,
mark read/unread), draft and send email, and answer questions about what is in the mailbox.

How to work:
- Before changing anything, look first: search or read the relevant messages so you act on facts.
- Prefer the smallest change that satisfies the request. Never send, archive, label or delete
  more than the user asked for.
- When sending or replying, show the user the final recipient, subject and body in your reply.
- If a request is ambiguous about WHICH emails are affected, ask one short clarifying question
  instead of guessing.
- Deleting is permanent from the user's point of view. Only delete when explicitly asked, and
  say exactly what was deleted.
- Report what you did in plain language, including message subjects and counts. Do not claim an
  action succeeded unless the tool result confirms it.
- Your only tools are the Gmail tools provided. You have no access to calendars, files or the
  web. Do not pretend otherwise.`;

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

export class GmailAgent {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(
    private readonly config: AgentConfig,
    private readonly store: Store,
    private readonly gmail: GmailMcpConnection,
  ) {}

  listPendingApprovals(conversationId?: string): PendingApproval[] {
    return [...this.pending.values()].filter((p) => !conversationId || p.conversationId === conversationId);
  }

  resolveApproval(approvalId: string, decision: "allow" | "deny"): boolean {
    const p = this.pending.get(approvalId);
    if (!p) return false;
    this.pending.delete(approvalId);
    p.resolve(decision);
    return true;
  }

  /** Run one user turn; streams events through `emit`, persists as it goes. */
  async runTurn(conversationId: string, userText: string, emit: (event: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) throw new Error(`conversation ${conversationId} not found`);

    this.store.addMessage(conversationId, "user", userText);
    if (conversation.title === "New conversation") this.store.touchConversation(conversationId, { title: userText.slice(0, 60) });

    const abort = new AbortController();
    signal?.addEventListener("abort", () => abort.abort(), { once: true });

    let endpoint;
    try {
      endpoint = await this.gmail.mcpEndpoint();
    } catch (error) {
      const msg = `Could not reach Gmail MCP: ${error instanceof Error ? error.message : String(error)}`;
      this.store.addMessage(conversationId, "system", msg);
      emit({ type: "error", message: msg });
      return;
    }

    const options: Options = {
      model: this.config.model,
      maxTurns: this.config.maxTurns,
      cwd: this.config.workDir,
      abortController: abort,
      includePartialMessages: true,
      settingSources: [], // nothing from ~/.claude leaks in
      tools: [], // no built-in tools at all — only the Gmail MCP tools below
      mcpServers: { gmail: { type: "http", url: endpoint.url, headers: endpoint.headers } },
      strictMcpConfig: true,
      systemPrompt: SYSTEM_PROMPT,
      permissionMode: "default",
      canUseTool: async (toolName, input, { toolUseID }) => {
        const category = classify(toolName, input);
        if (!category) return { behavior: "deny", message: "Only known Gmail MCP operations are permitted here." };
        if (allowedWithoutAsking(category, this.config.autonomy)) {
          this.store.startAction({ conversationId, toolUseId: toolUseID, tool: toolName, category, input, approval: "auto" });
          emit({ type: "tool_call", toolUseId: toolUseID, tool: toolName, category, input, approval: "auto" });
          return { behavior: "allow", updatedInput: input };
        }
        const approvalId = randomUUID();
        const decision = await new Promise<"allow" | "deny">((resolve) => {
          this.pending.set(approvalId, { id: approvalId, conversationId, toolUseId: toolUseID, tool: toolName, category, input, resolve });
          emit({ type: "approval_required", approvalId, toolUseId: toolUseID, tool: toolName, category, input });
          const timer = setTimeout(() => {
            if (this.pending.delete(approvalId)) resolve("deny");
          }, 5 * 60 * 1000);
          abort.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            if (this.pending.delete(approvalId)) resolve("deny");
          });
        });
        emit({ type: "approval_resolved", approvalId, decision });
        this.store.startAction({ conversationId, toolUseId: toolUseID, tool: toolName, category, input, approval: decision === "allow" ? "user" : "denied" });
        emit({ type: "tool_call", toolUseId: toolUseID, tool: toolName, category, input, approval: "user" });
        return decision === "allow" ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "The user declined this action." };
      },
      ...(conversation.sdk_session_id ? { resume: conversation.sdk_session_id } : {}),
    };

    let assistantText = "";
    let sessionSent = false;
    try {
      for await (const message of query({ prompt: userText, options })) {
        this.handle(message, conversationId, emit, {
          onSession: (id) => {
            if (sessionSent) return;
            sessionSent = true;
            this.store.touchConversation(conversationId, { sdk_session_id: id });
            emit({ type: "session", sdkSessionId: id });
          },
          onText: (delta) => {
            assistantText += delta;
          },
          onAssistantMessageComplete: () => {
            if (assistantText.trim()) {
              this.store.addMessage(conversationId, "assistant", assistantText);
              emit({ type: "text_done", text: assistantText });
              assistantText = "";
            }
          },
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.store.addMessage(conversationId, "system", `Error: ${msg}`);
      emit({ type: "error", message: msg });
    }
  }

  private handle(
    message: SDKMessage,
    conversationId: string,
    emit: (event: AgentEvent) => void,
    hooks: { onSession: (id: string) => void; onText: (delta: string) => void; onAssistantMessageComplete: () => void },
  ): void {
    if ("session_id" in message && typeof message.session_id === "string") hooks.onSession(message.session_id);

    switch (message.type) {
      case "stream_event": {
        const ev = message.event as { type: string; delta?: { type?: string; text?: string } };
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          hooks.onText(ev.delta.text);
          emit({ type: "text_delta", text: ev.delta.text });
        }
        return;
      }
      case "assistant": {
        const content = (message.message as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const block of content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>) {
            if (block.type === "tool_use" && block.id && block.name && !this.store.getActionByToolUse(block.id)) {
              const category = classify(block.name, block.input ?? {}) ?? "other";
              this.store.startAction({ conversationId, toolUseId: block.id, tool: block.name, category, input: block.input, approval: "auto" });
              emit({ type: "tool_call", toolUseId: block.id, tool: block.name, category, input: block.input, approval: "auto" });
            }
          }
        }
        hooks.onAssistantMessageComplete();
        return;
      }
      case "user": {
        const content = (message.message as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const block of content as Array<{ type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }>) {
            if (block.type === "tool_result" && block.tool_use_id) {
              const output = summariseToolOutput(block.content);
              this.store.finishAction(block.tool_use_id, output, Boolean(block.is_error));
              emit({ type: "tool_result", toolUseId: block.tool_use_id, output, isError: Boolean(block.is_error) });
            }
          }
        }
        return;
      }
      case "result": {
        const r = message as { total_cost_usd?: number; num_turns?: number; duration_ms?: number; stop_reason?: string | null; is_error?: boolean; result?: string; subtype?: string };
        this.store.recordTurnCost(conversationId, r.total_cost_usd ?? 0, r.num_turns ?? 0);
        if (r.is_error && r.subtype !== "success") emit({ type: "error", message: r.result ?? `agent ended with ${r.subtype}` });
        emit({ type: "done", costUsd: r.total_cost_usd ?? 0, turns: r.num_turns ?? 0, durationMs: r.duration_ms ?? 0, stopReason: r.stop_reason ?? null });
        return;
      }
      default:
        return;
    }
  }
}

function summariseToolOutput(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : null))
      .filter((t): t is string => t !== null);
    if (texts.length === content.length) return texts.join("\n");
  }
  return content;
}
