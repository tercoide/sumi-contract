// The AI assistant's panel, beside the tabs (the Gambas version's FAssistant window): the conversation, what
// it is doing as it goes, Send / Stop and a new chat. What it changes is in the History tab, and Undo takes
// back its whole answer. The conversation is the server's, per person and project.

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import * as api from "./api.ts";
import { tr } from "./tr.ts";

interface Entry {
  who: "you" | "ai";
  text: string;
  steps: string[];
  error?: string;
}

/** Text with its links (web addresses, and the program's own: a PDF report) */
function Linked({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /(https?:\/\/[^\s)\]>"']+|\/api\/projects\/[\w-]+\/report\/[^\s)\]>"']+)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(at, m.index));
    out.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noreferrer noopener">
        {m[0]}
      </a>,
    );
    at = m.index! + m[0].length;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

function Said({ e }: { e: Entry }) {
  if (e.who === "you") return <div className="said you">{e.text}</div>;
  return (
    <div className="said ai">
      {e.steps.length > 0 && (
        <ul className="steps">
          {e.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {e.text && (
        <div className="text">
          <Linked text={e.text} />
        </div>
      )}
      {e.error && <div className="error">✗ {e.error}</div>}
    </div>
  );
}

export function AssistantPanel({ project, onChanged, onClose }: { project: string; onChanged: () => void; onClose: () => void }) {
  const [state, setState] = useState<api.Result | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [live, setLive] = useState<Entry | null>(null); // the answer as it comes
  const [round, setRound] = useState(0);
  const [prompt, setPrompt] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.assistantState(project).then((r) => {
      setState(r);
      setEntries(r.entries ?? []);
    });
  }, [project]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" }); // (newer browsers return a promise: not the effect's cleanup)
  }, [entries, live]);

  const busy = live !== null || !!state?.busy;

  const send = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setPrompt("");
    setEntries((x) => [...x, { who: "you", text, steps: [] }]);
    let cur: Entry = { who: "ai", text: "", steps: [] };
    setLive(cur);
    setRound(1);
    await api.askAssistant(project, text, (e) => {
      if (e.type === "text") cur = { ...cur, text: cur.text + e.text };
      else if (e.type === "round") {
        setRound(e.n);
        if (cur.text && !cur.text.endsWith("\n")) cur = { ...cur, text: cur.text + "\n\n" };
      } else if (e.type === "step") {
        cur = { ...cur, steps: [...cur.steps, e.text] };
        if (e.changed) onChanged();
      } else if (e.type === "done") {
        setEntries((x) => [...x, e.entry]);
        setLive(null);
        setState((s) => s && { ...s, busy: false });
        onChanged();
        return;
      }
      setLive(cur);
    });
    setLive(null);
  };

  const newChat = async () => {
    const r = await api.assistantNew(project);
    if (!r.error) setEntries([]);
  };

  return (
    <aside className="assistant">
      <header>
        <strong>{tr("AI assistant")}</strong>
        <span className="muted model">{state?.model}</span>
        <span className="grow" />
        <button onClick={newChat} disabled={busy} title={tr("The assistant forgets this conversation")}>
          {tr("New chat")}
        </button>
        <button onClick={onClose} title={tr("Close")}>
          ✕
        </button>
      </header>
      <div className="chat">
        {entries.length === 0 && !live && (
          <p className="muted">
            {tr("Ask for anything about this project: find prices on the web and update them, make or fix analyses, change the project's data... Everything it changes is in the History tab, and Undo takes back its whole answer.")}
          </p>
        )}
        {state && !state.key && <p className="error">{tr("There is no API key: put it in the ANTHROPIC_API_KEY variable, or in data/ai.json, and start the server again.")}</p>}
        {entries.map((e, i) => (
          <Fragment key={i}>
            <Said e={e} />
          </Fragment>
        ))}
        {live && <Said e={live} />}
        {busy && <p className="muted working">{tr("&1 is working... (step &2)", state?.model ?? "Claude", round || 1)}</p>}
        <div ref={end} />
      </div>
      <footer>
        <textarea
          value={prompt}
          rows={3}
          placeholder={tr("Ask the assistant (Enter sends, Shift+Enter a new line)")}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <button onClick={() => api.assistantStop(project)}>{tr("Stop")}</button>
        ) : (
          <button className="primary" onClick={send} disabled={!prompt.trim()}>
            {tr("Send")}
          </button>
        )}
      </footer>
    </aside>
  );
}
