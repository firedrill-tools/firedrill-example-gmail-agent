// Gmail Agent — minimal single-page UI. No framework, no build step.

const $ = (sel, root = document) => root.querySelector(sel);
const toolLabel = (tool, input) => {
  if (tool === "Bash" && input && typeof input.command === "string") return input.command.split(/\s+/).slice(0, 4).join(" ");
  return tool.replace(/^mcp__gmail__/, "");
};
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const state = {
  conversations: [],
  activeId: null,
  streaming: false,
  toolCards: new Map(), // toolUseId -> card element
};

// ---------- tiny safe markdown-ish renderer ----------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function renderMarkdown(text) {
  const blocks = escapeHtml(text).split(/\n{2,}/);
  return blocks
    .map((b) => {
      if (b.startsWith("```")) return `<pre>${b.replace(/^```[a-z]*\n?/, "").replace(/```$/, "")}</pre>`;
      if (/^(\s*[-*] .+\n?)+$/.test(b)) {
        return `<ul>${b.split("\n").map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${inline(b).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1<em>$2</em>");
}

// ---------- API ----------
const api = {
  async json(url, opts = {}) {
    const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
    if (!r.ok) throw new Error(`${opts.method ?? "GET"} ${url} → ${r.status}`);
    return r.json();
  },
  health: () => api.json("/api/health"),
  conversations: () => api.json("/api/conversations"),
  conversation: (id) => api.json(`/api/conversations/${id}`),
  create: () => api.json("/api/conversations", { method: "POST", body: "{}" }),
  actions: () => api.json("/api/actions?limit=100"),
  approve: (id, decision) => api.json(`/api/approvals/${id}`, { method: "POST", body: JSON.stringify({ decision }) }),
};

// ---------- synthetic Gmail connection ----------
let gmail = { connected: false, summary: "checking…" };
async function refreshGmail() {
  try {
    const r = await fetch("/api/gmail/status");
    const body = await r.json().catch(() => ({}));
    gmail = r.ok ? body : { connected: false, summary: body.summary ?? `status unavailable (${r.status})` };
  } catch (e) {
    gmail = { connected: false, summary: `status unavailable: ${e.message}` };
  }
  const bar = $("#gmail-bar");
  bar.classList.toggle("ok", gmail.connected);
  bar.classList.toggle("bad", !gmail.connected);
  $("#gmail-summary").textContent = gmail.summary;
}
// ---------- sidebar ----------
async function refreshConversations() {
  state.conversations = await api.conversations();
  const list = $("#conversation-list");
  list.replaceChildren(
    ...state.conversations.map((c) => {
      const b = el("button", `conversation${c.id === state.activeId ? " active" : ""}`);
      b.append(el("span", "title", c.title));
      b.append(el("span", "sub", `${c.turn_count} turns · $${Number(c.total_cost_usd).toFixed(3)}`));
      b.onclick = () => openConversation(c.id);
      return b;
    }),
  );
}

// ---------- actions panel ----------
function actionSummary(a) {
  try {
    const input = JSON.parse(a.input_json ?? "null") ?? {};
    const parts = [];
    if (typeof input.command === "string") return input.command.slice(0, 90);
    for (const k of ["to", "subject", "query", "messageId", "labelIds", "addLabelIds", "removeLabelIds", "name"]) {
      if (input[k] !== undefined) parts.push(`${k}: ${Array.isArray(input[k]) ? input[k].join(",") : String(input[k]).slice(0, 60)}`);
    }
    return parts.join(" · ") || JSON.stringify(input).slice(0, 80);
  } catch {
    return "";
  }
}
async function refreshActions() {
  const actions = await api.actions();
  $("#actions-count").textContent = String(actions.length);
  $("#actions-list").replaceChildren(
    ...actions.map((a) => {
      const li = el("li", `action ${a.category}${a.is_error ? " error" : ""}`);
      const row = el("div", "row");
      let parsedInput = null; try { parsedInput = JSON.parse(a.input_json ?? "null"); } catch {}
      row.append(el("span", "tool", toolLabel(a.tool, parsedInput)));
      row.append(el("span", "time", new Date(a.started_at).toLocaleTimeString()));
      li.append(row);
      li.append(el("div", "summary", actionSummary(a)));
      li.append(el("span", `approval-tag ${a.approval}`, a.approval === "auto" ? "auto-approved" : a.approval === "user" ? "approved by you" : "denied"));
      return li;
    }),
  );
}

// ---------- chat rendering ----------
function scrollToEnd() {
  const m = $("#messages");
  m.scrollTop = m.scrollHeight;
}
function addUserMessage(text) {
  $("#messages").append(el("div", "msg user", text));
  scrollToEnd();
}
function addSystemMessage(text) {
  $("#messages").append(el("div", "msg system", text));
  scrollToEnd();
}
function startAssistantMessage() {
  const wrap = el("div", "msg assistant");
  const body = el("div", "body cursor");
  wrap.append(body);
  $("#messages").append(wrap);
  return { wrap, body, text: "" };
}
function finishAssistantMessage(m) {
  m.body.classList.remove("cursor");
  m.body.innerHTML = renderMarkdown(m.text);
  scrollToEnd();
}
function addToolCard({ toolUseId, tool, category, input, approval }) {
  const card = el("details", `tool-card ${category}`);
  const summary = el("summary");
  summary.append(el("span", `badge ${category}`, category));
  summary.append(el("span", "tool-name", toolLabel(tool, input)));
  summary.append(el("span", "state pending", approval === "user" ? "approved · running" : "running"));
  card.append(summary);
  const detail = el("div", "detail");
  detail.append(el("h4", null, "Input"));
  detail.append(el("pre", null, JSON.stringify(input, null, 2)));
  const outH = el("h4", null, "Result");
  const outPre = el("pre", null, "…");
  detail.append(outH, outPre);
  card.append(detail);
  $("#messages").append(card);
  state.toolCards.set(toolUseId, { card, outPre, stateEl: summary.querySelector(".state") });
  scrollToEnd();
}
function finishToolCard({ toolUseId, output, isError }) {
  const c = state.toolCards.get(toolUseId);
  if (!c) return;
  c.outPre.textContent = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  c.stateEl.textContent = isError ? "failed" : "done";
  c.stateEl.className = `state ${isError ? "err" : "ok"}`;
  if (isError) c.card.classList.add("error");
}
function addApproval({ approvalId, tool, input, category }) {
  const node = $("#tpl-approval").content.firstElementChild.cloneNode(true);
  node.dataset.approvalId = approvalId;
  node.classList.add(category);
  node.querySelector(".approval-tool").textContent = tool === "Bash" ? "run: " + toolLabel(tool, input) : toolLabel(tool, input).replace(/_/g, " ");
  node.querySelector(".approval-input").textContent = JSON.stringify(input, null, 2);
  for (const b of node.querySelectorAll("button")) {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await api.approve(approvalId, b.dataset.decision);
      } catch (e) {
        addSystemMessage(`Could not send decision: ${e.message}`);
      }
    };
  }
  $("#messages").append(node);
  scrollToEnd();
}
function resolveApproval({ approvalId, decision }) {
  const node = $(`.approval[data-approval-id="${approvalId}"]`);
  if (!node) return;
  node.classList.add("resolved");
  node.querySelector(".approval-title").textContent = decision === "allow" ? "You allowed this action." : "You denied this action.";
}

// ---------- open / send ----------
async function openConversation(id) {
  state.activeId = id;
  state.toolCards.clear();
  const data = await api.conversation(id);
  $("#chat-title").textContent = data.conversation.title;
  $("#chat-meta").textContent = `${data.conversation.turn_count} turns · $${Number(data.conversation.total_cost_usd).toFixed(3)}`;
  const m = $("#messages");
  m.replaceChildren();
  // Replay history: messages and actions interleaved by time.
  const items = [
    ...data.messages.map((x) => ({ t: x.created_at, kind: "message", x })),
    ...data.actions.map((x) => ({ t: x.started_at, kind: "action", x })),
  ].sort((a, b) => a.t.localeCompare(b.t));
  for (const it of items) {
    if (it.kind === "message") {
      if (it.x.role === "user") addUserMessage(it.x.content);
      else if (it.x.role === "assistant") {
        const am = startAssistantMessage();
        am.text = it.x.content;
        finishAssistantMessage(am);
      } else addSystemMessage(it.x.content);
    } else {
      addToolCard({ toolUseId: it.x.tool_use_id, tool: it.x.tool, category: it.x.category, input: JSON.parse(it.x.input_json), approval: it.x.approval });
      if (it.x.finished_at) finishToolCard({ toolUseId: it.x.tool_use_id, output: JSON.parse(it.x.output_json ?? "null"), isError: !!it.x.is_error });
    }
  }
  for (const p of data.pendingApprovals) addApproval(p);
  if (items.length === 0) {
    const empty = el("div", "empty");
    empty.append(el("h3", null, "What would you like to do with your inbox?"));
    empty.append(el("p", null, "Reads happen automatically. Sending, labelling and archiving follow the autonomy setting; deleting always asks you first."));
    m.append(empty);
  }
  await refreshConversations();
  $("#input").focus();
}

async function send(text) {
  if (!state.activeId) {
    const c = await api.create();
    await openConversation(c.id);
  }
  state.streaming = true;
  $("#send").disabled = true;
  $("#messages").querySelector(".empty")?.remove();
  addUserMessage(text);
  let assistant = null;

  const r = await fetch(`/api/conversations/${state.activeId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!r.ok || !r.body) {
    addSystemMessage(`Request failed: ${r.status}`);
    state.streaming = false;
    $("#send").disabled = false;
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (ev) => {
    switch (ev.type) {
      case "text_delta":
        if (!assistant) assistant = startAssistantMessage();
        assistant.text += ev.text;
        assistant.body.textContent = assistant.text;
        scrollToEnd();
        break;
      case "text_done":
        if (!assistant) assistant = startAssistantMessage();
        assistant.text = ev.text;
        finishAssistantMessage(assistant);
        assistant = null;
        break;
      case "tool_call":
        if (assistant && assistant.text) { finishAssistantMessage(assistant); assistant = null; }
        addToolCard(ev);
        refreshActions();
        break;
      case "tool_result":
        finishToolCard(ev);
        refreshActions();
        break;
      case "approval_required":
        addApproval(ev);
        break;
      case "approval_resolved":
        resolveApproval(ev);
        break;
      case "error":
        addSystemMessage(ev.message);
        break;
      case "done":
        if (assistant && assistant.text) { finishAssistantMessage(assistant); assistant = null; }
        $("#chat-meta").textContent = `$${ev.costUsd.toFixed(4)} this turn · ${ev.turns} turns · ${(ev.durationMs / 1000).toFixed(1)}s`;
        break;
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (data) {
        try { handle(JSON.parse(data.slice(6))); } catch { /* ignore malformed */ }
      }
    }
  }
  state.streaming = false;
  $("#send").disabled = false;
  await Promise.all([refreshConversations(), refreshActions()]);
  $("#input").focus();
}

// ---------- wiring ----------
$("#composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.streaming) return;
  const input = $("#input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";
  await send(text);
});
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#composer").requestSubmit();
  }
});
$("#input").addEventListener("input", (e) => {
  e.target.style.height = "auto";
  e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
});
$("#new-conversation").onclick = async () => {
  const c = await api.create();
  await openConversation(c.id);
};

(async function boot() {
  try {
    const h = await api.health();
    const s = $("#status");
    s.classList.add("ok");
    s.querySelector(".status-text").textContent = `${h.model} · autonomy: ${h.autonomy}`;
  } catch (e) {
    const s = $("#status");
    s.classList.add("bad");
    s.querySelector(".status-text").textContent = "server unreachable";
  }
  await refreshConversations();
  await refreshActions();
  await refreshGmail();
  setInterval(refreshGmail, 30_000);
  if (state.conversations[0]) await openConversation(state.conversations[0].id);
  else {
    const m = $("#messages");
    const empty = el("div", "empty");
    empty.append(el("h3", null, "What would you like to do with your inbox?"));
    empty.append(el("p", null, "Type below to start. A new conversation is created automatically."));
    m.append(empty);
  }
})();
