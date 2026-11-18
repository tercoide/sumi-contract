// The resources: every one in a grid edited in place (price, wage, override, loss, freight...), and the
// machine calculation of the selected equipment (as licita2003's equ sheet).

import { useState } from "react";
import { Num, Row, Text } from "../../fields.tsx";
import { fmt, tr } from "../../tr.ts";
import { useCommand, useWork } from "../../work.ts";

const KINDS = ["material", "labor", "equipment"];

export function ResourcesPage() {
  const w = useWork();
  const [text, setText] = useState("");
  const [kind, setKind] = useState("");
  const [sel, setSel] = useState("");
  const list = useCommand(w, "resource.list", { text, kind: kind || undefined, full: true, limit: 500 });
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const set = (r: any, field: string, v: unknown) => w.run("resource.set", { key: r.id, [field]: v });
  const items: any[] = list?.resources ?? [];
  const selected = items.find((r) => r.id === sel);

  const add = async (k: string) => {
    const names: Record<string, string> = { material: tr("New material"), labor: tr("New labor"), equipment: tr("New equipment") };
    const r = await w.run("resource.add", { kind: k, name: names[k], unit: k === "material" ? "u" : "h" });
    if (r.id) {
      setText("");
      setSel(r.id);
    }
  };
  const remove = async (r: any) => {
    if (!confirm(tr("Delete resource &1 &2?", r.code, r.name))) return;
    const res = await w.run("resource.delete", { key: r.id });
    if (res.error && confirm(res.error + "\n" + tr("Delete it anyway? Those lines will be missing."))) await w.run("resource.delete", { key: r.id, force: true });
  };

  return (
    <div>
      <div className="toolbar">
        <input className="search" placeholder={tr("Search by code or name")} value={text} onChange={(e) => setText(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{tr("All kinds")}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {tr(k)}
            </option>
          ))}
        </select>
        <button onClick={() => add("material")}>{tr("Add material")}</button>
        <button onClick={() => add("labor")}>{tr("Add labor")}</button>
        <button onClick={() => add("equipment")}>{tr("Add equipment")}</button>
      </div>
      {selected?.kind === "equipment" && <MachinePanel r={selected} />}
      <div className="scroll wide">
        <table className="grid resources">
          <thead>
            <tr>
              <th>{tr("Code")}</th>
              <th>{tr("Kind")}</th>
              <th>{tr("Name")}</th>
              <th>{tr("Unit")}</th>
              <th className="num">{tr("Price")}</th>
              <th className="num">{tr("Wage/h")}</th>
              <th className="num">{tr("Calculated")}</th>
              <th>{tr("Override")}</th>
              <th className="num">{tr("Loss %")}</th>
              <th>{tr("Origin")}</th>
              <th className="num">{tr("Distance km")}</th>
              <th className="num">{tr("Truck load")}</th>
              <th className="num">{tr("Unit price")}</th>
              <th>{tr("Updated")}</th>
              <th>{tr("Source")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className={(r.id === sel ? "selected" : "") + (r.unitPrice === 0 ? " problem" : "")} onClick={() => setSel(r.id)}>
                <td>
                  <Text value={r.code} onCommit={(v) => set(r, "code", v)} />
                </td>
                <td>
                  <select value={r.kind} onChange={(e) => set(r, "kind", e.target.value)}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {tr(k)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="namecol">
                  <Text value={r.name} onCommit={(v) => set(r, "name", v)} />
                </td>
                <td>
                  <Text value={r.unit} onCommit={(v) => set(r, "unit", v)} />
                </td>
                <td className="num">
                  <Num value={r.price} onCommit={(v) => set(r, "price", v)} onBad={bad} />
                </td>
                <td className="num">{r.kind === "labor" ? <Num value={r.wage ?? 0} onCommit={(v) => set(r, "wage", v)} onBad={bad} /> : null}</td>
                <td className="num">{r.calculated !== undefined ? fmt(r.calculated) : ""}</td>
                <td>{r.calculated !== undefined ? <input type="checkbox" checked={!!r.override} onChange={(e) => set(r, "override", e.target.checked)} title={tr("Use the typed price, not the calculation")} /> : null}</td>
                <td className="num">
                  <Num value={r.loss ?? 0} onCommit={(v) => set(r, "loss", v)} onBad={bad} />
                </td>
                <td>
                  <Text value={r.origin ?? ""} onCommit={(v) => set(r, "origin", v)} />
                </td>
                <td className="num">
                  <Num value={r.distance ?? 0} onCommit={(v) => set(r, "distance", v)} onBad={bad} />
                </td>
                <td className="num">
                  <Num value={r.truckLoad ?? 0} onCommit={(v) => set(r, "truckLoad", v)} onBad={bad} />
                </td>
                <td className="num strong">{fmt(r.unitPrice)}</td>
                <td className="nowrap">{r.updated ?? ""}</td>
                <td>{r.source ?? ""}</td>
                <td className="actions">
                  <button title={tr("Delete")} onClick={() => remove(r)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 500 && <p className="muted small">{tr("Only the first 500: search to find the others.")}</p>}
    </div>
  );
}

const MACHINE = [
  ["power", () => tr("Power (HP)")],
  ["cost", () => tr("Cost")],
  ["residualPct", () => tr("Residual value %")],
  ["lifeHours", () => tr("Life (hours)")],
  ["hoursPerYear", () => tr("Hours a year")],
  ["interestPct", () => tr("Interest % a year")],
  ["repairsPct", () => tr("Repairs % of depreciation")],
  ["fuelPrice", () => tr("Fuel price a liter")],
  ["fuelUse", () => tr("Fuel use (l / HP·h)")],
  ["lubricantPct", () => tr("Lubricants % of fuel")],
] as const;

/** The hourly cost of an equipment: depreciation + interest + repairs + fuel + lubricants */
function MachinePanel({ r }: { r: any }) {
  const w = useWork();
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const m = r.machine;
  return (
    <section>
      <h2>
        {tr("Machine")}: {r.code} {r.name}
      </h2>
      {!m ? (
        <p>
          <span className="muted">{tr("This equipment has no cost calculation (its typed price is used).")}</span>{" "}
          <button onClick={() => w.run("resource.set", { key: r.id, "machine.power": 0 })}>{tr("Add a cost calculation")}</button>
        </p>
      ) : (
        <>
          <div className="machine">
            {MACHINE.map(([f, label]) => (
              <Row key={f} label={label()}>
                <Num value={m[f]} onCommit={(v) => w.run("resource.set", { key: r.id, ["machine." + f]: v })} onBad={bad} />
              </Row>
            ))}
            <Row label={tr("Fuel")}>
              <Text value={m.fuel} onCommit={(v) => w.run("resource.set", { key: r.id, "machine.fuel": v })} />
            </Row>
          </div>
          <p className="note">
            {tr("Depreciation &1 + interest &2 + repairs &3 + fuel &4 + lubricants &5 = &6 an hour", ...["depreciation", "interest", "repairs", "fuel", "lubricants", "perHour"].map((k) => fmt(r.machineCost[k])))}
          </p>
          <button onClick={() => w.run("resource.set", { key: r.id, machine: null })}>{tr("Remove the calculation")}</button>
        </>
      )}
    </section>
  );
}
