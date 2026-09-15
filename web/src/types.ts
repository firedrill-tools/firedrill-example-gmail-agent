export type ActionCategory = "read" | "write" | "delete" | "other";
export type ActionApproval = "auto" | "user" | "denied";

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  total_cost_usd: number;
  turn_count: number;
}

export interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface Action {
  id: number;
  tool_use_id: string;
  tool: string;
  category: ActionCategory;
  input_json: string;
  output_json: string | null;
  is_error: number;
  approval: ActionApproval;
  started_at: string;
  finished_at: string | null;
}

export interface PendingApproval {
  id: string;
  toolUseId: string;
  tool: string;
  category: ActionCategory;
  input: unknown;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  actions: Action[];
  pendingApprovals: PendingApproval[];
}

export interface AgentHealth {
  ok: boolean;
  model: string;
  autonomy: "read" | "write" | "all";
  maxTurns: number;
  gmail: "mcp";
}

export interface GmailStatus {
  connected: boolean;
  summary: string;
  connectedAccountId: string | null;
}

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

export type TimelineEntry =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant" | "system";
      text: string;
      at: string;
      streaming?: boolean;
    }
  | {
      kind: "tool";
      id: string;
      toolUseId: string;
      tool: string;
      category: ActionCategory;
      input: unknown;
      output?: unknown;
      isError?: boolean;
      approval: ActionApproval;
      at: string;
      finished: boolean;
    }
  | {
      kind: "approval";
      id: string;
      approvalId: string;
      tool: string;
      category: ActionCategory;
      input: unknown;
      at: string;
      decision?: "allow" | "deny";
      submitting?: boolean;
    };
