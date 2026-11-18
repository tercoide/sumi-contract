// The analyses: the list (search, rubro) and the selected analysis as licita2003's sheet: header, lines by
// kind (materials, equipment, labor, sub-analyses), A B C D and the price. Quantities are edited in place;
// resources and sub-analyses are added by searching them.

import { useState } from "react";
import { Num, Row, Text } from "../../fields.tsx";
import { fmt, qty, tr } from "../../tr.ts";
import { useCommand, useWork } from "../../work.ts";
import { Pick } from "./Pick.tsx";

type Rubro = { number: number; name: string };

export function AnalysesPage({ rubros }: { rubros: Rubro[] }) {
  const w = useWork();
  const [text, setText] = useState("");
  const [rubro, setRubro] = useState(0);
  const [sel, setSelState] = useState(() => sessionStorage.getItem("sumi.pricing.analysis") || "");
  const setSel = (id: string) => {
    sessionStorage.setItem("sumi.pricing.analysis", id);
    setSelState(id);
  };
  const list = useCommand(w, "analysis.list", { text, rubro, limit: 400 });

  const create = async () => {
    const r = await w.run("analysis.add", { name: tr("New analysis"), unit: "u", rubro: rubro || undefined });
    if (r.id) setSel(r.id);
  };

  return (
    <div className="split">
      <div className="listside">
        <div className="toolbar">
          <input className="search" placeholder={tr("Search by code or name")} value={text} onChange={(e) => setText(e.target.value)} />
          <select value={rubro} onChange={(e) => setRubro(Number(e.target.value))}>
            <option value={0}>{tr("All rubros")}</option>
            {rubros.map((r) => (
              <option key={r.number} value={r.number}>
                {r.number} {r.name}
              </option>
            ))}
          </select>
          <button onClick={create}>{tr("New")}</button>
        </div>
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>{tr("Code")}</th>
                <th>{tr("Name")}</th>
                <th>{tr("Unit")}</th>
                <th className="num">{tr("Price")}</th>
              </tr>
            </thead>
            <tbody>
              {(list?.analyses ?? []).map((a: any) => (
                <tr key={a.id} className={"link" + (a.id === sel ? " selected" : "")} onClick={() => setSel(a.id)}>
                  <td>{a.code}</td>
                  <td>{a.name}</td>
                  <td>{a.unit}</td>
                  <td className="num">{fmt(a.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list?.analyses?.length === 400 && <p className="muted small">{tr("Only the first 400: search to find the others.")}</p>}
        </div>
      </div>
      <div>{sel ? <Sheet id={sel} rubros={rubros} onGone={() => setSel("")} onOpen={setSel} /> : <p className="muted">{tr("Choose an analysis")}</p>}</div>
    </div>
  );
}

const GROUPS = [
  { title: () => tr("A - Materials"), test: (l: any) => l.resource && l.kind !== "equipment" && l.kind !== "labor", part: "materials", yieldOf: "" },
  { title: () => tr("B - Equipment"), test: (l: any) => l.resource && l.kind === "equipment", part: "equipment", yieldOf: "equipmentYield" },
  { title: () => tr("C - Labor"), test: (l: any) => l.resource && l.kind === "labor", part: "labor", yieldOf: "laborYield" },
  { title: () => tr("Sub-analyses"), test: (l: any) => !!l.analysis, part: "", yieldOf: "" },
];

function Sheet({ id, rubros, onGone, onOpen }: { id: string; rubros: Rubro[]; onGone: () => void; onOpen: (id: string) => void }) {
  const w = useWork();
  const r = useCommand(w, "analysis.get", { key: id });
  const info = useCommand(w, "info");
  if (!r) return <p className="muted">…</p>;
  if (r.error) return <p className="muted">{tr("Choose an analysis")}</p>;
  const a = r.analysis;
  const cur = info?.currency ?? "$";
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const set = (field: string, v: unknown) => w.run("analysis.set", { key: id, [field]: v });

  const remove = async () => {
    if (!confirm(tr("Delete analysis &1 &2?", a.code, a.name))) return;
    let res = await w.run("analysis.delete", { key: id });
    if (res.error && a.usedBy.length && confirm(res.error + "\n" + tr("Delete it anyway? Those lines will be missing."))) res = await w.run("analysis.delete", { key: id, force: true });
    if (!res.error) onGone();
  };
  const copy = async () => {
    const res = await w.run("analysis.copy", { key: id, name: a.name + " " + tr("(copy)") });
    if (res.id) onOpen(res.id);
  };
  const flatten = async () => confirm(tr("The sub-analyses become their resources and stop following their changes. Go on?")) && w.run("analysis.flatten", { key: id });
  const hasSubs = a.lines.some((l: any) => l.analysis);

  return (
    <div>
      <section>
        <div className="sheethead">
          <Row label={tr("Code")}>
            <Text value={a.code} onCommit={(v) => set("code", v)} />
          </Row>
          <Row label={tr("Name")}>
            <Text value={a.name} onCommit={(v) => set("name", v)} />
          </Row>
          <Row label={tr("Unit")}>
            <Text value={a.unit} onCommit={(v) => set("unit", v)} />
          </Row>
          <Row label={tr("Rubro")}>
            <select value={a.rubro} onChange={(e) => set("rubro", Number(e.target.value))}>
              <option value={0}>{tr("(none)")}</option>
              {rubros.map((x) => (
                <option key={x.number} value={x.number}>
                  {x.number} {x.name}
                </option>
              ))}
              {a.rubro && !rubros.some((x) => x.number === a.rubro) ? <option value={a.rubro}>{a.rubro}</option> : null}
            </select>
          </Row>
          <Row label={tr("Labor yield")}>
            <span title={tr("Units made with the labor of the lines (e.g. a crew's day): the labor is divided by it")}>
              <Num value={a.laborYield ?? 1} onCommit={(v) => set("laborYield", v)} onBad={bad} />
            </span>
          </Row>
          <Row label={tr("Equipment yield")}>
            <span title={tr("Units made with the equipment hours of the lines: the equipment is divided by it")}>
              <Num value={a.equipmentYield ?? 1} onCommit={(v) => set("equipmentYield", v)} onBad={bad} />
            </span>
          </Row>
          <Row label={tr("Note")}>
            <Text value={a.note ?? ""} onCommit={(v) => set("note", v)} />
          </Row>
        </div>
        <div className="toolbar">
          <button onClick={copy} title={tr("A copy of this analysis, to change it")}>
            {tr("Copy")}
          </button>
          <button onClick={flatten} disabled={!hasSubs} title={tr("The sub-analyses become their resources (the link is lost)")}>
            {tr("Flatten")}
          </button>
          <button onClick={remove}>{tr("Delete")}</button>
          {a.usedBy.length > 0 && <span className="muted small">{tr("Used by &1", a.usedBy.join(", "))}</span>}
        </div>
      </section>

      <table className="grid sheet">
        <thead>
          <tr>
            <th>{tr("Code")}</th>
            <th>{tr("Description")}</th>
            <th>{tr("Unit")}</th>
            <th className="num">{tr("Quantity")}</th>
            <th className="num">{tr("Unit price")}</th>
            <th className="num">{tr("Cost")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => {
            const lines = a.lines.filter(g.test);
            if (!lines.length) return null;
            const y = g.yieldOf ? (a[g.yieldOf] ?? 1) : 1;
            return [
              <tr key={g.title()} className="rubro">
                <td colSpan={7}>{g.title()}</td>
              </tr>,
              ...lines.map((l: any) => (
                <tr key={l.index} className={l.code ? "" : "problem"}>
                  <td>{l.code ?? "?"}</td>
                  <td>
                    {l.analysis && l.code ? (
                      <a href="#" onClick={(e) => (e.preventDefault(), onOpen(l.analysis))}>
                        {l.name}
                      </a>
                    ) : (
                      (l.name ?? (l.analysis ? tr("(missing analysis)") : tr("(missing resource)")))
                    )}
                  </td>
                  <td>{l.unit}</td>
                  <td className="num">
                    <Num value={l.qty} onCommit={(v) => w.run("analysis.setline", { key: id, index: l.index, qty: v })} onBad={bad} />
                  </td>
                  <td className="num">{fmt(l.unitPrice ?? 0)}</td>
                  <td className="num">{fmt(l.cost)}</td>
                  <td className="actions">
                    <button title={tr("Remove line")} onClick={() => w.run("analysis.removeline", { key: id, index: l.index })}>
                      ×
                    </button>
                  </td>
                </tr>
              )),
              g.part ? (
                <tr key={g.title() + "t"} className="subtotal">
                  <td colSpan={5}>{y !== 1 ? tr("÷ yield &1", qty(y)) : ""}</td>
                  <td className="num">{fmt(a[g.part])}</td>
                  <td />
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      <div className="toolbar">
        <Pick what="resource" placeholder={tr("Add a resource: search by code or name")} onPick={(x) => w.run("analysis.addline", { key: id, resource: x.id, qty: 1 })} />
        <Pick what="analysis" placeholder={tr("Add a sub-analysis")} onPick={(x) => w.run("analysis.addline", { key: id, analysis: x.id, qty: 1 })} />
      </div>
      <section className="totals">
        <div>{tr("A materials &1   B equipment &2   C labor &3   D direct cost &4", fmt(a.materials), fmt(a.equipment), fmt(a.labor), fmt(a.direct))}</div>
        <div className="strong">{tr("Price = D × &1 = &2 &3 a &4", fmt(info?.priceFactor ?? 1, 4), cur, fmt(a.price), a.unit)}</div>
        {a.problems.length > 0 && (
          <ul className="problems">
            {a.problems.map((p: string, i: number) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
