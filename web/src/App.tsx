import { Activity, AlertCircle, ArrowUpRight, MailCheck, Menu, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { streamTurn } from "./stream";
import type {
  Action,
  AgentEvent,
  AgentHealth,
  Conversation,
  ConversationDetail,
  GmailStatus,
  TimelineEntry,
} from "./types";
import { parseStoredValue } from "./format";
import { ActivityPanel } from "./components/ActivityPanel";
import { ChatTimeline } from "./components/ChatTimeline";
import { Composer } from "./components/Composer";
import { ConversationRail } from "./components/ConversationRail";

const suggestions = [
  "Find the latest invoice",
  "Summarize my unread messages",
  "Which messages need a reply?",
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function storedTimeline(detail: ConversationDetail): TimelineEntry[] {
  const messages: TimelineEntry[] = detail.messages.map((message) => ({
    kind: "message",
    id: `message-${message.id}`,
    role: message.role,
    text: message.content,
    at: message.created_at,
  }));
  const tools: TimelineEntry[] = detail.actions.map((action) => ({
    kind: "tool",
    id: `tool-${action.tool_use_id}`,
    toolUseId: action.tool_use_id,
    tool: action.tool,
    category: action.category,
    input: parseStoredValue(action.input_json),
    output: parseStoredValue(action.output_json),
    isError: Boolean(action.is_error),
    approval: action.approval,
    at: action.started_at,
    finished: Boolean(action.finished_at),
  }));
  const approvals: TimelineEntry[] = detail.pendingApprovals.map((approval) => ({
    kind: "approval",
    id: `approval-${approval.id}`,
    approvalId: approval.id,
    tool: approval.tool,
    category: approval.category,
    input: approval.input,
    at: new Date().toISOString(),
  }));
  return [...messages, ...tools, ...approvals].sort((left, right) => left.at.localeCompare(right.at));
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timelineBottomRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const selectionRef = useRef(0);

  const activeConversation = conversations.find((item) => item.id === activeId);
  const connected = Boolean(health && gmail?.connected);

  async function refreshGmail(): Promise<void> {
    try {
      setGmail(await api.gmail());
    } catch (error) {
      setGmail({ connected: false, connectedAccountId: null, summary: errorText(error) });
    }
  }

  async function openConversation(id: string): Promise<void> {
    if (busyRef.current) return;
    const selection = ++selectionRef.current;
    setActiveId(id);
    setLoading(true);
    setRailOpen(false);
    try {
      const detail = await api.conversation(id);
      if (selection !== selectionRef.current) return;
      setTimeline(storedTimeline(detail));
      setActions(detail.actions);
      setNotice(null);
    } catch (error) {
      if (selection === selectionRef.current) setNotice(`Could not open conversation: ${errorText(error)}`);
    } finally {
      if (selection === selectionRef.current) setLoading(false);
    }
  }

  async function boot(): Promise<void> {
    setLoading(true);
    try {
      const [agent, list] = await Promise.all([api.health(), api.conversations()]);
      setHealth(agent);
      setConversations(list);
      setNotice(null);
      if (list[0]) await openConversation(list[0].id);
      else {
        setActiveId(null);
        setTimeline([]);
        setActions([]);
      }
    } catch (error) {
      setHealth(null);
      setNotice(`Agent server unavailable: ${errorText(error)}. Start it with npm start, then retry.`);
    } finally {
      setLoading(false);
      await refreshGmail();
    }
  }

  useEffect(() => {
    void boot();
    const interval = window.setInterval(() => { void refreshGmail(); }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    timelineBottomRef.current?.scrollIntoView({ behavior: streaming ? "instant" : "smooth", block: "end" });
  }, [timeline, streaming]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setRailOpen(false);
        setActivityOpen(false);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  async function newConversation(): Promise<void> {
    if (busyRef.current || !health) return;
    setLoading(true);
    try {
      const created = await api.createConversation();
      ++selectionRef.current;
      setConversations(await api.conversations());
      setActiveId(created.id);
      setTimeline([]);
      setActions([]);
      setRailOpen(false);
      setActivityOpen(false);
      setNotice(null);
      inputRef.current?.focus();
    } catch (error) {
      setNotice(`Could not create conversation: ${errorText(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function approve(approvalId: string, decision: "allow" | "deny"): Promise<void> {
    setTimeline((previous) => previous.map((entry) =>
      entry.kind === "approval" && entry.approvalId === approvalId ? { ...entry, submitting: true } : entry,
    ));
    try {
      await api.approve(approvalId, decision);
    } catch (error) {
      setTimeline((previous) => previous.map((entry) =>
        entry.kind === "approval" && entry.approvalId === approvalId ? { ...entry, submitting: false } : entry,
      ));
      setNotice(`Could not send approval: ${errorText(error)}`);
    }
  }

  async function refreshAfterTurn(id: string): Promise<void> {
    try {
      const [detail, list] = await Promise.all([api.conversation(id), api.conversations()]);
      setConversations(list);
      if (id === activeId || activeId === null) {
        setActiveId(id);
        setTimeline(storedTimeline(detail));
        setActions(detail.actions);
      }
    } catch (error) {
      setNotice(`The turn ended, but the saved conversation could not be loaded: ${errorText(error)}`);
    }
  }

  async function sendMessage(): Promise<void> {
    const text = draft.trim();
    if (!text || !connected || busyRef.current) return;
    busyRef.current = true;
    setStreaming(true);
    setNotice(null);
    setDraft("");
    let conversationId = activeId;
    let assistantDraftId: string | null = null;
    let finished = false;
    let failed = false;

    const closeDraft = () => {
      if (!assistantDraftId) return;
      const id = assistantDraftId;
      setTimeline((previous) => previous.map((entry) =>
        entry.kind === "message" && entry.id === id ? { ...entry, streaming: false } : entry,
      ));
      assistantDraftId = null;
    };

    const handleEvent = (event: AgentEvent) => {
      switch (event.type) {
        case "text_delta": {
          if (!assistantDraftId) {
            assistantDraftId = `stream-${crypto.randomUUID()}`;
            const id = assistantDraftId;
            setTimeline((previous) => [...previous, {
              kind: "message", id, role: "assistant", text: event.text, at: new Date().toISOString(), streaming: true,
            }]);
          } else {
            const id = assistantDraftId;
            setTimeline((previous) => previous.map((entry) =>
              entry.kind === "message" && entry.id === id ? { ...entry, text: entry.text + event.text } : entry,
            ));
          }
          break;
        }
        case "text_done": {
          if (assistantDraftId) {
            const id = assistantDraftId;
            setTimeline((previous) => previous.map((entry) =>
              entry.kind === "message" && entry.id === id ? { ...entry, text: event.text, streaming: false } : entry,
            ));
            assistantDraftId = null;
          } else {
            setTimeline((previous) => [...previous, {
              kind: "message", id: `response-${crypto.randomUUID()}`, role: "assistant",
              text: event.text, at: new Date().toISOString(),
            }]);
          }
          break;
        }
        case "tool_call":
          closeDraft();
          setTimeline((previous) => [...previous, {
            kind: "tool", id: `tool-${event.toolUseId}`, toolUseId: event.toolUseId,
            tool: event.tool, category: event.category, input: event.input, approval: event.approval,
            at: new Date().toISOString(), finished: false,
          }]);
          break;
        case "tool_result":
          setTimeline((previous) => previous.map((entry) =>
            entry.kind === "tool" && entry.toolUseId === event.toolUseId
              ? { ...entry, output: event.output, isError: event.isError, finished: true }
              : entry,
          ));
          break;
        case "approval_required":
          closeDraft();
          setTimeline((previous) => [...previous, {
            kind: "approval", id: `approval-${event.approvalId}`, approvalId: event.approvalId,
            tool: event.tool, category: event.category, input: event.input, at: new Date().toISOString(),
          }]);
          break;
        case "approval_resolved":
          setTimeline((previous) => previous.map((entry) =>
            entry.kind === "approval" && entry.approvalId === event.approvalId
              ? { ...entry, decision: event.decision, submitting: false }
              : entry,
          ));
          break;
        case "error":
          failed = true;
          setTimeline((previous) => [...previous, {
            kind: "message", id: `error-${crypto.randomUUID()}`, role: "system",
            text: event.message, at: new Date().toISOString(),
          }]);
          break;
        case "done":
          finished = true;
          closeDraft();
          break;
        case "session":
          break;
      }
    };

    try {
      if (!conversationId) {
        const created = await api.createConversation();
        conversationId = created.id;
        setActiveId(created.id);
        setConversations((previous) => [created, ...previous]);
      }
      setTimeline((previous) => [...previous, {
        kind: "message", id: `user-${crypto.randomUUID()}`, role: "user",
        text, at: new Date().toISOString(),
      }]);
      await streamTurn(conversationId, text, handleEvent);
      closeDraft();
      if (!finished && !failed) throw new Error("The agent connection closed before the turn finished. Reload to inspect saved work.");
    } catch (error) {
      setNotice(`Message could not complete: ${errorText(error)}`);
    } finally {
      busyRef.current = false;
      setStreaming(false);
      if (conversationId) await refreshAfterTurn(conversationId);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="app-shell">
      <ConversationRail
        conversations={conversations}
        activeId={activeId}
        health={health}
        busy={streaming || loading}
        open={railOpen}
        onClose={() => setRailOpen(false)}
        onNew={() => { void newConversation(); }}
        onSelect={(id) => { void openConversation(id); }}
      />

      <main className="chat-workspace">
        <header className="workspace-header">
          <button className="icon-button mobile-menu" aria-label="Open conversations" onClick={() => setRailOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="header-title">
            <h1>{activeConversation?.title ?? "New conversation"}</h1>
            <span>{gmail?.connected ? <><MailCheck size={15} /> Synthetic Gmail connected</> : "Synthetic Gmail unavailable"}</span>
          </div>
          <button
            className={`button button-header ${activityOpen ? "active" : ""}`}
            onClick={() => setActivityOpen((previous) => !previous)}
            aria-expanded={activityOpen}
            aria-controls="activity-panel"
          >
            <Activity size={17} />
            Activity
            {actions.length > 0 && <span className="activity-count">{actions.length}</span>}
          </button>
        </header>

        {notice && (
          <div className="notice" role="alert">
            <AlertCircle size={17} />
            <span>{notice}</span>
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setNotice(null)}><X size={16} /></button>
          </div>
        )}
        {!health || !gmail?.connected ? (
          <div className="connection-banner">
            <span>
              {!health
                ? "Start the agent server with npm start."
                : "Start Firedrill serve and set this app's GMAIL_MCP_URL and GMAIL_MCP_TOKEN."}
            </span>
            <button className="button button-quiet" onClick={() => { void boot(); }}>
              <RefreshCw size={15} />
              Retry
            </button>
          </div>
        ) : null}

        <section className="message-scroll" aria-label="Conversation" aria-live="polite">
          {loading && timeline.length === 0 ? (
            <div className="loading-state">Loading conversation…</div>
          ) : timeline.length === 0 ? (
            <div className="conversation-empty">
              <span className="empty-icon" aria-hidden="true"><MailCheck size={26} strokeWidth={1.7} /></span>
              <h2>Ask about the inbox</h2>
              <p>This assistant uses a synthetic Gmail mailbox. It can search, read, and—when you ask—change mail through the Tool.</p>
              <div className="suggestions" aria-label="Suggested messages">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} onClick={() => { setDraft(suggestion); inputRef.current?.focus(); }} disabled={!connected}>
                    {suggestion}<ArrowUpRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ChatTimeline entries={timeline} onApprove={(id, decision) => { void approve(id, decision); }} />
          )}
          <div ref={timelineBottomRef} />
        </section>

        <Composer
          draft={draft}
          busy={streaming || loading}
          connected={connected}
          inputRef={inputRef}
          onDraftChange={setDraft}
          onSubmit={() => { void sendMessage(); }}
        />
      </main>
      <ActivityPanel actions={actions} open={activityOpen} onClose={() => setActivityOpen(false)} />
    </div>
  );
}
