import { AlertCircle, ChevronDown, Check, LoaderCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TimelineEntry } from "../types";
import { categoryLabel, prettyValue, shortInput, toolTitle } from "../format";

interface Props {
  entries: TimelineEntry[];
  onApprove: (id: string, decision: "allow" | "deny") => void;
}

export function ChatTimeline({ entries, onApprove }: Props) {
  return (
    <div className="timeline">
      {entries.map((entry) => {
        if (entry.kind === "message") {
          if (entry.role === "user") {
            return <div className="user-message" key={entry.id}>{entry.text}</div>;
          }
          if (entry.role === "system") {
            return <p className="system-message" key={entry.id}><AlertCircle size={16} />{entry.text}</p>;
          }
          return (
            <article className="assistant-message" key={entry.id}>
              <div className="speaker-label">Gmail Agent</div>
              {entry.streaming ? (
                <p className="streaming-text">{entry.text}<span className="typing-caret" aria-hidden="true" /></p>
              ) : (
                <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.text}</ReactMarkdown></div>
              )}
            </article>
          );
        }

        if (entry.kind === "approval") {
          return (
            <section className={`approval-card ${entry.decision ? "resolved" : ""}`} key={entry.id} aria-label="Action approval">
              <div className="approval-heading">
                <strong>{entry.decision ? (entry.decision === "allow" ? "Action approved" : "Action denied") : "Approve this Gmail action?"}</strong>
                <span>{toolTitle(entry.tool)}</span>
              </div>
              {!entry.decision && (
                <>
                  <pre className="code-view">{prettyValue(entry.input)}</pre>
                  <div className="approval-actions">
                    <button className="button button-quiet" disabled={entry.submitting} onClick={() => onApprove(entry.approvalId, "deny")}>Deny</button>
                    <button className="button button-primary" disabled={entry.submitting} onClick={() => onApprove(entry.approvalId, "allow")}>
                      {entry.submitting ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                      Allow action
                    </button>
                  </div>
                </>
              )}
            </section>
          );
        }

        return (
          <details className="tool-event" key={entry.id}>
            <summary>
              <span className={`tool-category ${entry.category}`}>{categoryLabel(entry.category)}</span>
              <span className="tool-event-name">{toolTitle(entry.tool)}</span>
              {shortInput(entry.input) && <span className="tool-event-context">{shortInput(entry.input)}</span>}
              <span className={`tool-result ${entry.isError ? "failed" : ""}`}>
                {entry.finished ? (entry.isError ? "Failed" : "Done") : "Running"}
              </span>
              <ChevronDown size={16} className="detail-chevron" aria-hidden="true" />
            </summary>
            <div className="tool-event-detail">
              <div className="detail-label">Input</div>
              <pre className="code-view">{prettyValue(entry.input)}</pre>
              <div className="detail-label">Result</div>
              <pre className="code-view">{entry.finished ? prettyValue(entry.output) : "Waiting for the tool…"}</pre>
            </div>
          </details>
        );
      })}
    </div>
  );
}
