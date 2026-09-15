import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type Role = "user" | "assistant" | "system";
export type ActionCategory = "read" | "write" | "delete" | "other";
export type ActionApproval = "auto" | "user" | "denied";

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  sdk_session_id: string | null;
  total_cost_usd: number;
  turn_count: number;
}

export interface Message {
  id: number;
  conversation_id: string;
  role: Role;
  content: string;
  created_at: string;
}

export interface Action {
  id: number;
  conversation_id: string;
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

const now = () => new Date().toISOString();

export class Store {
  private readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sdk_session_id TEXT,
        total_cost_usd REAL NOT NULL DEFAULT 0,
        turn_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, id);
      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        tool_use_id TEXT NOT NULL UNIQUE,
        tool TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('read','write','delete','other')),
        input_json TEXT NOT NULL,
        output_json TEXT,
        is_error INTEGER NOT NULL DEFAULT 0,
        approval TEXT NOT NULL CHECK (approval IN ('auto','user','denied')),
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS actions_conversation ON actions(conversation_id, id);
    `);
  }

  // ---- conversations -------------------------------------------------------

  createConversation(title = "New conversation"): Conversation {
    const id = randomUUID();
    const ts = now();
    this.db
      .prepare(`INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, title, ts, ts);
    return this.getConversation(id)!;
  }

  listConversations(): Conversation[] {
    return this.db.prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`).all() as Conversation[];
  }

  getConversation(id: string): Conversation | undefined {
    return this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as Conversation | undefined;
  }

  deleteConversation(id: string): boolean {
    return this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id).changes > 0;
  }

  touchConversation(id: string, patch: Partial<Pick<Conversation, "title" | "sdk_session_id">> = {}): void {
    const sets: string[] = ["updated_at = @updated_at"];
    const params: Record<string, unknown> = { id, updated_at: now() };
    if (patch.title !== undefined) {
      sets.push("title = @title");
      params.title = patch.title;
    }
    if (patch.sdk_session_id !== undefined) {
      sets.push("sdk_session_id = @sdk_session_id");
      params.sdk_session_id = patch.sdk_session_id;
    }
    this.db.prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE id = @id`).run(params);
  }

  recordTurnCost(id: string, costUsd: number, turns: number): void {
    this.db
      .prepare(
        `UPDATE conversations
           SET total_cost_usd = total_cost_usd + ?, turn_count = turn_count + ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(costUsd, turns, now(), id);
  }

  // ---- messages ------------------------------------------------------------

  addMessage(conversationId: string, role: Role, content: string): Message {
    const info = this.db
      .prepare(`INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)`)
      .run(conversationId, role, content, now());
    return this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(info.lastInsertRowid) as Message;
  }

  listMessages(conversationId: string): Message[] {
    return this.db
      .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY id`)
      .all(conversationId) as Message[];
  }

  // ---- actions (the audit trail of what the agent did in Gmail) ------------

  startAction(input: {
    conversationId: string;
    toolUseId: string;
    tool: string;
    category: ActionCategory;
    input: unknown;
    approval: ActionApproval;
  }): Action {
    this.db
      .prepare(
        `INSERT INTO actions (conversation_id, tool_use_id, tool, category, input_json, approval, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tool_use_id) DO UPDATE SET approval = excluded.approval`,
      )
      .run(
        input.conversationId,
        input.toolUseId,
        input.tool,
        input.category,
        JSON.stringify(input.input ?? null),
        input.approval,
        now(),
      );
    return this.getActionByToolUse(input.toolUseId)!;
  }

  finishAction(toolUseId: string, output: unknown, isError: boolean): Action | undefined {
    this.db
      .prepare(`UPDATE actions SET output_json = ?, is_error = ?, finished_at = ? WHERE tool_use_id = ?`)
      .run(JSON.stringify(output ?? null), isError ? 1 : 0, now(), toolUseId);
    return this.getActionByToolUse(toolUseId);
  }

  getActionByToolUse(toolUseId: string): Action | undefined {
    return this.db.prepare(`SELECT * FROM actions WHERE tool_use_id = ?`).get(toolUseId) as Action | undefined;
  }

  listActions(conversationId?: string, limit = 200): Action[] {
    if (conversationId) {
      return this.db
        .prepare(`SELECT * FROM actions WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`)
        .all(conversationId, limit) as Action[];
    }
    return this.db.prepare(`SELECT * FROM actions ORDER BY id DESC LIMIT ?`).all(limit) as Action[];
  }

  close(): void {
    this.db.close();
  }
}
