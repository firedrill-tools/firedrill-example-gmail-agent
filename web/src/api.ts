import type { AgentHealth, Conversation, ConversationDetail, GmailStatus } from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string; summary?: string } | null;
    throw new ApiError(body?.error ?? body?.summary ?? `Request failed (HTTP ${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => json<AgentHealth>("/api/health"),
  gmail: () => json<GmailStatus>("/api/gmail/status"),
  conversations: () => json<Conversation[]>("/api/conversations"),
  conversation: (id: string) => json<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`),
  createConversation: () => json<Conversation>("/api/conversations", { method: "POST", body: "{}" }),
  approve: (id: string, decision: "allow" | "deny") =>
    json<{ ok: true; decision: "allow" | "deny" }>(`/api/approvals/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
};
