import { Mail, Plus, X } from "lucide-react";
import type { AgentHealth, Conversation } from "../types";
import { displayDay } from "../format";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  health: AgentHealth | null;
  busy: boolean;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
}

export function ConversationRail({
  conversations,
  activeId,
  health,
  busy,
  open,
  onClose,
  onNew,
  onSelect,
}: Props) {
  return (
    <>
      {open && <button className="mobile-scrim" aria-label="Close conversations" onClick={onClose} />}
      <aside className={`rail ${open ? "rail-open" : ""}`} aria-label="Conversations">
        <div className="rail-head">
          <div className="brand-lockup">
            <span className="brand-icon" aria-hidden="true"><Mail size={19} strokeWidth={2} /></span>
            <span>Gmail Agent</span>
          </div>
          <button className="icon-button mobile-close" aria-label="Close conversations" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <button className="new-conversation" onClick={onNew} disabled={busy || !health}>
          <Plus size={17} strokeWidth={2.2} />
          New conversation
        </button>
        <div className="rail-section-title">Conversations</div>
        <nav className="conversation-nav">
          {conversations.length === 0 ? (
            <p className="rail-empty">Your conversations will appear here.</p>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`conversation-link ${conversation.id === activeId ? "selected" : ""}`}
                onClick={() => onSelect(conversation.id)}
                disabled={busy}
                aria-current={conversation.id === activeId ? "page" : undefined}
              >
                <span className="conversation-title">{conversation.title}</span>
                <span className="conversation-date">{displayDay(conversation.updated_at)}</span>
              </button>
            ))
          )}
        </nav>
        <div className="rail-footer">
          <span className="footer-label">{health ? "Local agent ready" : "Agent server unavailable"}</span>
          {health && <span className="footer-model">{health.model}</span>}
        </div>
      </aside>
    </>
  );
}
