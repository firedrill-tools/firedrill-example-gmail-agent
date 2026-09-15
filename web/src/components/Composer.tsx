import { LoaderCircle, Send } from "lucide-react";
import { useEffect, type RefObject } from "react";

interface Props {
  draft: string;
  busy: boolean;
  connected: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}

export function Composer({ draft, busy, connected, inputRef, onDraftChange, onSubmit }: Props) {
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
  }, [draft, inputRef]);

  return (
    <form className="composer-shell" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="composer-box">
        <textarea
          ref={inputRef}
          aria-label="Message Gmail Agent"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={connected ? "Ask about the synthetic inbox…" : "Connect the agent and Gmail Tool to start"}
          disabled={!connected || busy}
          rows={1}
        />
        <button
          className="button button-primary send-button"
          type="submit"
          aria-label={busy ? "Agent working" : "Send message"}
          disabled={!connected || busy || !draft.trim()}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
          <span>{busy ? "Working" : "Send"}</span>
        </button>
      </div>
      <div className="composer-foot">Enter to send · Shift+Enter for a new line</div>
    </form>
  );
}
