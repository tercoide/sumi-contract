// The company's contractors and their documents (port of FContractors): shared by all the projects, changed
// at once (with the company's own log). Documents that expire within 15 days (or have) show in red.

import { useState } from "react";
import { Row, Text } from "../fields.tsx";
import { tr } from "../tr.ts";
import { useCommand, useWork } from "../work.ts";

const FIELDS = [
  ["name", () => tr("Name")],
  ["trade", () => tr("Trade")],
  ["taxId", () => tr("Tax id")],
  ["contact", () => tr("Contact")],
  ["phone", () => tr("Phone")],
  ["email", () => tr("Email")],
  ["address", () => tr("Address")],
  ["bank", () => tr("Bank (CBU)")],
  ["note", () => tr("Note")],
] as const;

function soon(expires: string): boolean {
  if (!expires) return false;
  const days = (Date.parse(expires) - Date.now()) / 86400000;
  return days <= 15;
}

export function ContractorsPanel({ close }: { close: () => void }) {
  const w = useWork();
  const r = useCommand(w, "contractor.list");
  const [sel, setSel] = useState("");
  const [name, setName] = useState("");
  const ks: any[] = r?.contractors ?? [];
  const k = ks.find((x) => x.id === sel);
  const set = (field: string, v: unknown) => w.run("contractor.set", { key: k.id, [field]: v });
  const setDocs = (docs: any[]) => set("docs", docs);

  return (
    <section className="contractors">
      <h2>
        {tr("The company's contractors and their documents")} <button onClick={close}>{tr("Close")}</button>
      </h2>
      <p className="muted small">{tr("Shared by all the projects of the company. Red: a document expired or expiring within 15 days.")}</p>
      <div className="split">
        <div>
          <table className="grid">
            <thead>
              <tr>
                <th>{tr("Name")}</th>
                <th>{tr("Trade")}</th>
                <th>{tr("Documents")}</th>
              </tr>
            </thead>
            <tbody>
              {ks.map((x) => (
                <tr key={x.id} className={"link" + (x.id === sel ? " selected" : "") + (x.docsDue.length ? " problem" : "")} onClick={() => setSel(x.id)}>
                  <td>{x.name}</td>
                  <td>{x.trade}</td>
                  <td className={x.docsDue.length ? "error" : "muted"}>{x.docsDue.length ? x.docsDue.join(", ") : x.docs.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar">
            <input placeholder={tr("New contractor")} value={name} onChange={(e) => setName(e.target.value)} />
            <button
              disabled={!name.trim()}
              onClick={async () => {
                const res = await w.run("contractor.add", { name: name.trim() });
                if (res.id) {
                  setSel(res.id);
                  setName("");
                }
              }}
            >
              {tr("Add")}
            </button>
          </div>
        </div>
        <div>
          {k && (
            <>
              {FIELDS.map(([f, label]) => (
                <Row key={f} label={label()}>
                  <Text value={k[f]} onCommit={(v) => set(f, v)} />
                </Row>
              ))}
              <h2>{tr("Documents")}</h2>
              <table className="grid">
                <thead>
                  <tr>
                    <th>{tr("Kind")}</th>
                    <th>{tr("Number")}</th>
                    <th>{tr("Expires")}</th>
                    <th>{tr("Note")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {k.docs.map((d: any, i: number) => {
                    const change = (field: string, v: string) => setDocs(k.docs.map((x: any, j: number) => (j === i ? { ...x, [field]: v } : x)));
                    return (
                      <tr key={i} className={soon(d.expires) ? "problem" : ""}>
                        <td>
                          <Text value={d.kind} onCommit={(v) => change("kind", v)} placeholder="ART, seguro, AFIP..." />
                        </td>
                        <td>
                          <Text value={d.number} onCommit={(v) => change("number", v)} />
                        </td>
                        <td className={soon(d.expires) ? "error" : ""}>
                          <input type="date" value={d.expires} onChange={(e) => change("expires", e.target.value)} />
                        </td>
                        <td>
                          <Text value={d.note} onCommit={(v) => change("note", v)} />
                        </td>
                        <td className="actions">
                          <button title={tr("Remove document")} onClick={() => setDocs(k.docs.filter((_: any, j: number) => j !== i))}>
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="toolbar">
                <button onClick={() => setDocs([...k.docs, { kind: "", number: "", expires: "", file: "", note: "" }])}>{tr("Add document")}</button>
                <span className="grow" />
                <button onClick={async () => confirm(tr("Delete contractor &1 for all the projects?", k.name)) && !(await w.run("contractor.delete", { key: k.id })).error && setSel("")}>{tr("Delete")}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
