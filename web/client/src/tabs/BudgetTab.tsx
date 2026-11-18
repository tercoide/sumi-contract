// The Budget tab (port of FBudget): the items by rubro with their quantities, unit prices and totals; adding
// an item from an analysis or a manual one, changing quantities, moving and deleting. A quantity that came
// from the design and was changed by hand shows in orange; an item with a problem says it.

import { useState } from "react";
import { Num, Text } from "../fields.tsx";
import { fmt, qty, tr } from "../tr.ts";
import { useCommand, useWork } from "../work.ts";

export function BudgetTab() {
  const w = useWork();
  const r = useCommand(w, "budget.list");
  const info = useCommand(w, "info");
  if (!r) return <p className="muted">…</p>;
  if (r.error) return <p className="error">{r.error}</p>;
  const cur = info?.currency ?? "$";
  const bad = (why: string) => w.setStatus({ text: why, error: true });

  return (
    <div>
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
