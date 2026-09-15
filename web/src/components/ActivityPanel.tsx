import { ChevronDown, X } from "lucide-react";
import type { Action } from "../types";
import { categoryLabel, displayTime, parseStoredValue, prettyValue, shortInput, toolTitle } from "../format";

interface Props {
  actions: Action[];
  open: boolean;
  onClose: () => void;
}

export function ActivityPanel({ actions, open, onClose }: Props) {
  if (!open) return null;
  return (
    <>
      <button className="activity-scrim" aria-label="Close activity" onClick={onClose} />
      <aside id="activity-panel" className="activity-panel" aria-label="Tool activity">
        <header className="activity-head">
          <div>
            <h2>Tool activity</h2>
            <p>What the agent did in this conversation</p>
          </div>
          <button className="icon-button" aria-label="Close activity" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="activity-body">
          {actions.length === 0 ? (
            <p className="activity-empty">No Gmail tools called yet. Ask the agent to find or change something in the mailbox.</p>
          ) : (
            [...actions].reverse().map((action) => {
              const input = parseStoredValue(action.input_json);
              const output = parseStoredValue(action.output_json);
              return (
                <details className="activity-item" key={action.id}>
                  <summary>
                    <div className="activity-item-main">
                      <span className="activity-item-name">{toolTitle(action.tool)}</span>
                      <span className="activity-item-summary">{shortInput(input) || categoryLabel(action.category)}</span>
                    </div>
                    <span className="activity-item-time">{displayTime(action.started_at)}</span>
                    <ChevronDown size={15} className="detail-chevron" aria-hidden="true" />
                  </summary>
                  <div className="activity-item-detail">
                    <div className="activity-outcome">
                      {action.is_error ? "Tool failed" : action.finished_at ? "Completed" : "Running"}
                      {action.approval === "user" ? " · approved by you" : action.approval === "denied" ? " · denied" : ""}
                    </div>
                    <div className="detail-label">Input</div>
                    <pre className="code-view">{prettyValue(input)}</pre>
                    <div className="detail-label">Result</div>
                    <pre className="code-view">{action.finished_at ? prettyValue(output) : "Waiting for the tool…"}</pre>
                  </div>
                </details>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
