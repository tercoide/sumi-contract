// The Budget tab (port of FBudget): the items by rubro with their quantities, unit prices and totals; adding
// an item from an analysis or a manual one, changing quantities, moving and deleting. A quantity that came
// from the design and was changed by hand shows in orange; an item with a problem says it.

import { useState } from "react";
import { Num, Text } from "../fields.tsx";
import { fmt, parseNum, qty, tr } from "../tr.ts";
import { useCommand, useWork } from "../work.ts";

export function BudgetTab() {
  const w = useWork();
  const r = useCommand(w, "budget.list");
  const info = useCommand(w, "info");
  const [design, setDesign] = useState(false);
  if (!r) return <p className="muted">…</p>;
  if (r.error) return <p className="error">{r.error}</p>;
  const cur = info?.currency ?? "$";
  const bad = (why: string) => w.setStatus({ text: why, error: true });

  return (
    <div>
      <div className="toolbar right">
        <button className={design ? "on" : ""} onClick={() => setDesign(!design)} title={tr("The quantities of the building, from a sumi-designer file")}>
          {tr("From the design")}
        </button>
      </div>
      {design && <DesignPanel />}
      <AddItem />
      <table className="grid budget">
        <thead>
          <tr>
            <th>{tr("Code")}</th>
            <th>{tr("Description")}</th>
            <th>{tr("Unit")}</th>
            <th className="num">{tr("Quantity")}</th>
            <th className="num">{tr("Unit price")}</th>
            <th className="num">{tr("Total")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {r.rubros.map((g: any) => (
            <Rubro key={g.rubro} g={g} items={r.items.filter((b: any) => b.rubro === g.rubro)} cur={cur} bad={bad} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>{tr("Direct cost &1 &2   Price &1 &3", cur, fmt(r.direct), fmt(r.price))}</td>
            <td className="num strong">{fmt(r.price)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      {r.items.length === 0 && <p className="muted">{tr("The budget has no items yet: add them from the analyses of the Pricing tab, or manual ones.")}</p>}
    </div>
  );
}

function Rubro({ g, items, cur, bad }: { g: any; items: any[]; cur: string; bad: (why: string) => void }) {
  const w = useWork();
  return (
    <>
      <tr className="rubro">
        <td>{g.rubro}</td>
        <td colSpan={4}>
          {g.name || tr("Rubro &1", g.rubro)}
          {g.coefs.length > 0 && <span className="muted small"> · {g.coefs.map((k: any) => `${k.name} ${fmt(k.pct, 1)}%`).join(", ")}</span>}
        </td>
        <td className="num">{fmt(g.price)}</td>
        <td />
      </tr>
      {items.map((b) => (
        <tr key={b.id} className={b.problem ? "problem" : ""} title={b.problem ?? ""}>
          <td>{b.code}</td>
          <td>
            <Text value={b.description} onCommit={(v) => w.run("item.set", { key: b.id, description: v })} />
          </td>
          <td>{b.unit}</td>
          <td className={"num" + (b.qtySource === "design" && Math.abs(b.qty - b.designQty) > 1e-9 ? " overridden" : "")}>
            <Num value={b.qty} onCommit={(v) => w.run("item.set", { key: b.id, qty: v })} onBad={bad} />
          </td>
          <td className="num">{fmt(b.unitPrice)}</td>
          <td className="num">{fmt(b.total)}</td>
          <td className="actions">
            <button title={tr("Up")} onClick={() => w.run("item.move", { key: b.id, by: -1 })}>
              ↑
            </button>
            <button title={tr("Down")} onClick={() => w.run("item.move", { key: b.id, by: 1 })}>
              ↓
            </button>
            <button title={tr("Delete")} onClick={() => confirm(tr("Delete item &1 &2?", b.code, b.description)) && w.run("item.delete", { key: b.id })}>
              ×
            </button>
          </td>
        </tr>
      ))}
    </>
  );
}

/** Adding an item: from an analysis (searched by code or name), or a manual one */
function AddItem() {
  const w = useWork();
  const [text, setText] = useState("");
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ description: "", unit: "gl", unitCost: "", rubro: "", qty: "1" });
  const found = useCommand(w, "analysis.list", { text, limit: 12 });

  if (manual)
    return (
      <div className="toolbar">
        <strong>{tr("New manual item")}</strong>
        <input placeholder={tr("Description")} value={m.description} onChange={(e) => setM({ ...m, description: e.target.value })} />
        <input placeholder={tr("Unit")} className="short" value={m.unit} onChange={(e) => setM({ ...m, unit: e.target.value })} />
        <input placeholder={tr("Unit cost")} className="num" value={m.unitCost} onChange={(e) => setM({ ...m, unitCost: e.target.value })} />
        <input placeholder={tr("Rubro")} className="short" value={m.rubro} onChange={(e) => setM({ ...m, rubro: e.target.value })} />
        <input placeholder={tr("Quantity")} className="num" value={m.qty} onChange={(e) => setM({ ...m, qty: e.target.value })} />
        <button
          onClick={async () => {
            const r = await w.run("item.add", { description: m.description, unit: m.unit, unitCost: m.unitCost || 0, rubro: m.rubro || 0, qty: m.qty || 0 });
            if (!r.error) setManual(false);
          }}
        >
          {tr("Add")}
        </button>
        <button onClick={() => setManual(false)}>{tr("Cancel")}</button>
      </div>
    );

  return (
    <div className="toolbar">
      <input className="search" placeholder={tr("Add an item: search an analysis by code or name")} value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={() => setManual(true)}>{tr("Add manual item")}</button>
      {text && found?.analyses && (
        <div className="dropdown">
          {found.analyses.length === 0 && <div className="muted">{tr("No analysis has that.")}</div>}
          {found.analyses.map((a: any) => (
            <div
              key={a.id}
              className="link"
              onClick={async () => {
                await w.run("item.add", { analysis: a.id, qty: 0 });
                setText("");
              }}
            >
              <b>{a.code}</b> {a.name} <span className="muted">
                ({a.unit}, {qty(a.price)})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** "52; 79 x 2" -> [{code: "52", factor: 1}, {code: "79", factor: 2}] (null if a factor isn't a number) */
function parseRefs(text: string): { code: string; factor: number }[] | null {
  const out = [];
  for (const part of text.split(";").map((x) => x.trim()).filter(Boolean)) {
    const [code, f] = part.split(/\s*[x×*]\s*/i);
    const factor = f === undefined ? 1 : parseNum(f);
    if (factor === null) return null;
    out.push({ code: code.trim(), factor });
  }
  return out;
}

const showRefs = (list: { code: string; factor: number }[]) => list.map((a) => (a.factor === 1 ? a.code : `${a.code} x ${qty(a.factor)}`)).join("; ");

/** The quantities of the last sumi-designer file loaded, the analyses of each row, and the budget made from them
 *  (port of FDesign; the file is uploaded, as the server can't read the person's disk) */
function DesignPanel() {
  const w = useWork();
  const rows = useCommand(w, "design.rows");
  const [report, setReport] = useState<string[] | null>(null);
  const load = async (f: File | undefined) => {
    if (!f) return;
    await w.run("design.load", { name: f.name, text: await f.text() });
  };
  const sync = async () => {
    const r = await w.run("design.sync");
    if (!r.error) setReport(r.report);
  };
  const setMap = (key: string, text: string) => {
    const list = parseRefs(text);
    if (!list) return w.setStatus({ text: tr("&1 is not a number.", text), error: true });
    w.run("design.map", { key, analyses: list });
  };
  return (
    <section className="design">
      <h2>{tr("From the design")}</h2>
      <div className="toolbar">
        <label className="button">
          {tr("Load a sumi-designer file...")}
          <input type="file" accept=".designer-proj,application/json" hidden onChange={(e) => load(e.target.files?.[0])} />
        </label>
        {rows?.ok && (
          <>
            <span className="muted">{tr("&1, saved &2: &3 rows", rows.name, rows.date, rows.rows.length)}</span>
            <button className="primary" onClick={sync}>
              {tr("Update the budget")}
            </button>
          </>
        )}
      </div>
      {rows?.error && <p className="muted">{rows.error}</p>}
      {rows?.ok && (
        <>
          <p className="muted small">{tr("Analyses: codes of the Pricing tab, with a factor if needed (plaster on both faces: 79 x 2).")}</p>
          <table className="grid">
            <thead>
              <tr>
                <th>{tr("Group")}</th>
                <th>{tr("Item")}</th>
                <th>{tr("Unit")}</th>
                <th className="num">{tr("Quantity")}</th>
                <th>{tr("Analyses")}</th>
                <th>{tr("From")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((r: any) => (
                <tr key={r.key} className={r.analyses.length ? "" : "problem"}>
                  <td>{r.group}</td>
                  <td>{r.item}</td>
                  <td>{r.unit}</td>
                  <td className="num">{qty(r.qty)}</td>
                  <td>{r.fromDesigner ? showRefs(r.analyses) : <Text value={showRefs(r.analyses)} placeholder="52; 79 x 2" onCommit={(v) => setMap(r.key, v)} />}</td>
                  <td className="muted">{r.fromDesigner ? "sumi-designer" : r.analyses.length ? tr("this project") : tr("none")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {report && (
        <div className="report">
          <pre>{report.join("\n")}</pre>
        </div>
      )}
    </section>
  );
}
