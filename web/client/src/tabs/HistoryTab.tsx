// The History tab (port of FHistory): the change log, newest first, searchable; a change shows what it did,
// with its targets before and after. Undo and redo are in the top bar.

import { Fragment, useState } from "react";
import { tr } from "../tr.ts";
import { useCommand, useWork } from "../work.ts";

const ABSENT = "~absent~";

export function HistoryTab() {
  const w = useWork();
  const [text, setText] = useState("");
  const [open, setOpen] = useState("");
  const r = useCommand(w, "log", { limit: 500 });
  if (!r) return <p className="muted">…</p>;
  if (r.error) return <p className="error">{r.error}</p>;
  const t = text.toLowerCase();
  const list = (r.changes as any[]).filter((h) => !t || `${h.who} ${h.summary}`.toLowerCase().includes(t));

  return (
    <div>
      <div className="toolbar">
        <input className="search" placeholder={tr("Search in who and what")} value={text} onChange={(e) => setText(e.target.value)} />
        <span className="muted">{tr("&1 changes", list.length)}</span>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>{tr("When")}</th>
            <th>{tr("Who")}</th>
            <th>{tr("How")}</th>
            <th>{tr("What")}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((h) => (
            <Fragment key={h.id}>
              <tr className={"link" + (h.undone ? " undone" : "")} onClick={() => setOpen(open === h.id ? "" : h.id)}>
                <td className="nowrap">{h.when}</td>
                <td>{h.who}</td>
                <td>{h.via.split(" ").map((v: string, i: number) => (i === 0 ? tr(v) : v)).join(" ")}</td>
                <td>
                  {h.summary}
                  {h.undone && <span className="muted"> ({tr("undone")})</span>}
                </td>
              </tr>
              {open === h.id && (
                <tr>
                  <td colSpan={4}>
                    <Detail id={h.id} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ id }: { id: string }) {
  const w = useWork();
  const r = useCommand(w, "change.get", { id });
  if (!r?.change) return <p className="muted">…</p>;
  const h = r.change;
  const show = (v: unknown) => (v === ABSENT || v === null || v === undefined ? tr("(didn't exist)") : JSON.stringify(v, null, 1));
  return (
    <div className="detail">
      <p>
        <b>{tr("Command")}</b> {h.command} <code>{JSON.stringify(h.args)}</code>
      </p>
      {h.targets.map((t: string) => (
        <div key={t} className="beforeafter">
          <div>
            <b>
              {t} — {tr("before")}
            </b>
            <pre>{show(h.before[t])}</pre>
          </div>
          <div>
            <b>{tr("after")}</b>
            <pre>{t in (h.after ?? {}) ? show(h.after[t]) : "—"}</pre>
          </div>
        </div>
      ))}
    </div>
  );
}
