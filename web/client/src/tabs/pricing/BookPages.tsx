// The labor charges (what an hour of labor costs besides the wage) and the rubros of the price book

import { useState } from "react";
import { Num, Text } from "../../fields.tsx";
import { fmt, tr } from "../../tr.ts";
import { useWork } from "../../work.ts";

export function ChargesPage({ charges, total }: { charges: any[]; total: number }) {
  const w = useWork();
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const set = (i: number, field: string, v: unknown) => w.run("charge.set", { index: i, [field]: v });
  return (
    <div className="narrow">
      <p className="muted">{tr("What an hour of labor costs besides the wage: a % of it (social charges, presentismo, vacations...) or an amount spread over some hours (a monthly bonus over 176 h, work clothes over a semester...).")}</p>
      <table className="grid">
        <thead>
          <tr>
            <th>{tr("Charge")}</th>
            <th className="num">{tr("% of the wage")}</th>
            <th className="num">{tr("Amount")}</th>
            <th className="num">{tr("Over hours")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {charges.map((h, i) => (
            <tr key={i}>
              <td>
                <Text value={h.name} onCommit={(v) => set(i, "name", v)} />
              </td>
              <td className="num">
                <Num value={h.pct} onCommit={(v) => set(i, "pct", v)} onBad={bad} />
              </td>
              <td className="num">
                <Num value={h.amount} onCommit={(v) => set(i, "amount", v)} onBad={bad} />
              </td>
              <td className="num">
                <Num value={h.hours} onCommit={(v) => set(i, "hours", v)} onBad={bad} />
              </td>
              <td className="actions">
                <button title={tr("Remove")} onClick={() => w.run("charge.delete", { index: i })}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{tr("Total")}</td>
            <td className="num">{fmt(total)} %</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
      <div className="toolbar">
        <button onClick={() => w.run("charge.add", { name: tr("New charge") })}>{tr("Add")}</button>
      </div>
    </div>
  );
}

export function RubrosPage({ rubros }: { rubros: { number: number; name: string }[] }) {
  const w = useWork();
  const [n, setN] = useState("");
  const [name, setName] = useState("");
  const remove = async (r: { number: number; name: string }) => {
    const res = await w.run("rubro.delete", { number: r.number });
    if (res.error && confirm(res.error + "\n" + tr("Remove it anyway?"))) await w.run("rubro.delete", { number: r.number, force: true });
  };
  const next = rubros.reduce((m, r) => Math.max(m, r.number), 0) + 1;
  return (
    <div className="narrow">
      <table className="grid">
        <thead>
          <tr>
            <th className="num">{tr("Number")}</th>
            <th>{tr("Name")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rubros.map((r) => (
            <tr key={r.number}>
              <td className="num">{r.number}</td>
              <td>
                <Text value={r.name} onCommit={(v) => v.trim() && w.run("rubro.set", { number: r.number, name: v })} />
              </td>
              <td className="actions">
                <button title={tr("Remove")} onClick={() => remove(r)}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="toolbar">
        <input className="short" placeholder={String(next)} value={n} onChange={(e) => setN(e.target.value)} />
        <input placeholder={tr("Name")} value={name} onChange={(e) => setName(e.target.value)} />
        <button
          disabled={!name.trim()}
          onClick={async () => {
            const r = await w.run("rubro.set", { number: Number(n) || next, name: name.trim() });
            if (!r.error) {
              setN("");
              setName("");
            }
          }}
        >
          {tr("Add")}
        </button>
      </div>
    </div>
  );
}
