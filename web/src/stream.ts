import { ApiError } from "./api";
import type { AgentEvent } from "./types";

function parseBlock(block: string): AgentEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as AgentEvent;
  } catch {
    throw new Error("The agent sent an unreadable event. Reload the conversation to inspect what was saved.");
  }
}

export async function streamTurn(
  conversationId: string,
  text: string,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Could not send message (HTTP ${response.status})`, response.status);
  }
  if (!response.body) throw new Error("This browser cannot read the agent's response stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const event = parseBlock(buffer.slice(0, boundary));
        if (event) onEvent(event);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    const last = parseBlock(buffer.trim());
    if (last) onEvent(last);
  } finally {
    reader.releaseLock();
  }
}
