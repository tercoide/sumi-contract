// The Contracts tab (port of FContracts): the project's contracts with the company's contractors. Left: the
// list (amount, progress, balance). Right: the selected contract's conditions and three pages: its items
// (budget items, the quantity and the agreed price), its certificates (amounts, and the measures of the
// selected one: the accumulated quantity of each item) and its payments. The contractors and their documents
// are the company's (ContractorsPanel). Every change goes through the commands.

import { Fragment, useState } from "react";
import { openReport } from "../api.ts";
import { Num, Row, Text } from "../fields.tsx";
import { fmt, qty, tr } from "../tr.ts";
import { useCommand, useWork } from "../work.ts";
import { ContractorsPanel } from "./ContractorsPanel.tsx";

export function ContractsTab() {
  const w = useWork();
  const list = useCommand(w, "contract.list");
  const contractors = useCommand(w, "contractor.list");
  const info = useCommand(w, "info");
  const [sel, setSelState] = useState(() => sessionStorage.getItem("sumi.contract") || "");
  const [showContractors, setShowContractors] = useState(false);
  const [newWith, setNewWith] = useState("");
  const setSel = (id: string) => {
    sessionStorage.setItem("sumi.contract", id);
    setSelState(id);
  };
  if (!list || !contractors) return <p className="muted">…</p>;
  if (list.error) return <p className="error">{list.error}</p>;
  const cur = info?.currency ?? "$";
  const ks: any[] = contractors.contractors ?? [];
  const cs: any[] = list.contracts;
  const total = cs.reduce((f, k) => f + k.amount, 0);
  const due = cs.reduce((f, k) => f + k.balance, 0);
  const current = cs.find((k) => k.id === sel) ? sel : cs[0]?.id ?? "";

  const create = async () => {
    if (!newWith) return;
    const r = await w.run("contract.add", { contractor: newWith });
    if (r.id) {
      setSel(r.id);
      setNewWith("");
    }
  };

  return (
    <div>
      <div className="toolbar">
        <select value={newWith} onChange={(e) => setNewWith(e.target.value)}>
          <option value="">{tr("New contract with...")}</option>
          {ks.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
              {k.trade ? ` (${k.trade})` : ""}
            </option>
          ))}
        </select>
        <button disabled={!newWith} onClick={create}>
          {tr("New contract")}
        </button>
        <button onClick={() => setShowContractors(!showContractors)} title={tr("The company's contractors and their documents")}>
          {tr("Contractors...")}
        </button>
        <span className="grow" />
        <span className="strong">{tr("&1 contracts, &2 &3; to pay &2 &4", cs.length, cur, fmt(total), fmt(due))}</span>
      </div>
      {showContractors && <ContractorsPanel close={() => setShowContractors(false)} />}
      {ks.length === 0 && !showContractors && <p className="muted">{tr("There are no contractors yet: add them with Contractors... (they are the company's, shared by all the projects).")}</p>}
      <div className="split">
        <div>
          <table className="grid">
            <thead>
              <tr>
                <th>{tr("Code")}</th>
                <th>{tr("Contractor")}</th>
                <th className="num">{tr("Amount")}</th>
                <th className="num">{tr("Done")}</th>
                <th className="num">{tr("Balance")}</th>
              </tr>
            </thead>
            <tbody>
              {cs.map((k) => (
                <tr key={k.id} className={"link" + (k.id === current ? " selected" : "")} onClick={() => setSel(k.id)}>
                  <td>{k.code}</td>
                  <td>
                    {k.contractor}
                    <div className="muted small">{k.title}</div>
                  </td>
                  <td className="num">{fmt(k.amount)}</td>
                  <td className="num">{fmt(k.progress * 100, 0)} %</td>
                  <td className="num">{fmt(k.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {cs.length === 0 && <p className="muted">{tr("No contracts yet: choose a contractor and make one.")}</p>}
        </div>
        <div>{current && <Contract id={current} contractors={ks} cur={cur} onGone={() => setSel("")} />}</div>
      </div>
    </div>
  );
}

function Contract({ id, contractors, cur, onGone }: { id: string; contractors: any[]; cur: string; onGone: () => void }) {
  const w = useWork();
  const r = useCommand(w, "contract.get", { key: id });
  const [page, setPage] = useState("items");
  if (!r) return <p className="muted">…</p>;
  if (r.error) return null;
  const k = r.contract;
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const set = (field: string, v: unknown) => w.run("contract.set", { key: id, [field]: v });
  const remove = async () => confirm(tr("Delete contract &1 with its certificates and payments?", k.code)) && !(await w.run("contract.delete", { key: id })).error && onGone();

  return (
    <div>
      <section>
        <h2>
          {k.code} · {k.contractorName}
        </h2>
        <div className="sheethead">
          <Row label={tr("Contractor")}>
            <select value={k.contractor} onChange={(e) => set("contractor", e.target.value)}>
              {!contractors.some((c) => c.id === k.contractor) && <option value={k.contractor}>{k.contractorName}</option>}
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={tr("Title")}>
            <Text value={k.title} onCommit={(v) => set("title", v)} />
          </Row>
          <Row label={tr("Signed")}>
            <input type="date" value={k.signed} onChange={(e) => set("signed", e.target.value)} />
          </Row>
          <Row label={tr("Advance %")}>
            <Num value={k.advancePct} onCommit={(v) => set("advancePct", v)} onBad={bad} />
          </Row>
          <Row label={tr("Retention %")}>
            <Num value={k.retentionPct} onCommit={(v) => set("retentionPct", v)} onBad={bad} />
          </Row>
          <Row label={tr("Index")}>
            <Text value={k.indexName} onCommit={(v) => set("indexName", v)} />
          </Row>
          <Row label={tr("Base index")}>
            <Num value={k.baseIndex} onCommit={(v) => set("baseIndex", v)} onBad={bad} />
          </Row>
          <Row label={tr("Base month")}>
            <input type="month" value={k.baseMonth} onChange={(e) => set("baseMonth", e.target.value)} />
          </Row>
          <Row label={tr("Note")}>
            <Text value={k.note} onCommit={(v) => set("note", v)} />
          </Row>
        </div>
        <p className="strong">{tr("Amount &1 &2 · done &3 % · certified &1 &4 · paid &1 &5 · balance &1 &6", cur, fmt(k.amount), fmt(k.progress * 100, 1), fmt(k.certified), fmt(k.paid), fmt(k.balance))}</p>
        <div className="toolbar">
          <button
            onClick={async () => {
              const r = await openReport(w.id, { kind: "account", contract: k.id });
              w.setStatus(r.error ? { text: r.error, error: true } : { text: tr("&1: &2 pages", r.name, r.pages), error: false });
            }}
            title={tr("The contract's certificates, payments and balance, in PDF")}
          >
            <img className="icon" src="/icons/document-print.svg" alt="" /> {tr("Account")}
          </button>
          <button onClick={remove}>{tr("Delete")}</button>
        </div>
      </section>
      <nav className="subtabs">
        {[
          ["items", tr("Items")],
          ["certs", tr("Certificates")],
          ["payments", tr("Payments")],
        ].map(([p, label]) => (
          <button key={p} className={p === page ? "on" : ""} onClick={() => setPage(p)}>
            {label}
          </button>
        ))}
      </nav>
      {page === "items" && <Parts k={k} />}
      {page === "certs" && <Certificates k={k} />}
      {page === "payments" && <Payments k={k} />}
    </div>
  );
}

/** What the contract takes of the budget: items (or part of them) at the agreed price */
function Parts({ k }: { k: any }) {
  const w = useWork();
  const budget = useCommand(w, "budget.list");
  const [item, setItem] = useState("");
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const set = (p: any, field: string, v: unknown) => w.run("part.set", { contract: k.id, part: p.id, [field]: v });
  return (
    <div>
      <table className="grid">
        <thead>
          <tr>
            <th>{tr("Item")}</th>
            <th>{tr("Description")}</th>
            <th>{tr("Unit")}</th>
            <th className="num">{tr("Quantity")}</th>
            <th className="num">{tr("% of the item")}</th>
            <th className="num">{tr("Agreed price")}</th>
            <th className="num">{tr("Total")}</th>
            <th className="num">{tr("Measured")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {k.parts.map((p: any) => (
            <tr key={p.id}>
              <td>{p.code}</td>
              <td>{p.description}</td>
              <td>{p.unit}</td>
              <td className="num">
                <Num value={p.qty} onCommit={(v) => set(p, "qty", v)} onBad={bad} />
              </td>
              <td className="num">{p.pctOfItem !== undefined ? fmt(p.pctOfItem * 100, 1) + " %" : ""}</td>
              <td className="num" title={p.budgetUnitPrice !== undefined ? tr("Budget: &1", fmt(p.budgetUnitPrice)) : ""}>
                <Num value={p.unitPrice} onCommit={(v) => set(p, "unitPrice", v)} onBad={bad} />
              </td>
              <td className="num">{fmt(p.qty * p.unitPrice)}</td>
              <td className="num">{qty(p.measured)}</td>
              <td className="actions">
                <button title={tr("Remove")} onClick={() => w.run("part.remove", { contract: k.id, part: p.id })}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="toolbar">
        <select value={item} onChange={(e) => setItem(e.target.value)}>
          <option value="">{tr("Add a budget item...")}</option>
          {(budget?.items ?? []).map((b: any) => (
            <option key={b.id} value={b.id}>
              {b.code} {b.description}
            </option>
          ))}
        </select>
        <button disabled={!item} onClick={async () => !(await w.run("part.add", { contract: k.id, item })).error && setItem("")} title={tr("What no contract takes yet of the item, at the budget's unit price")}>
          {tr("Add")}
        </button>
      </div>
    </div>
  );
}

/** The certificates: their amounts, and the selected one's measures */
function Certificates({ k }: { k: any }) {
  const w = useWork();
  const [sel, setSel] = useState<number>(k.certificates.length ? k.certificates[k.certificates.length - 1].number : 0);
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const q = k.certificates.find((c: any) => c.number === sel);
  const add = async (kind: string) => {
    const r = await w.run("cert.add", { contract: k.id, kind });
    if (r.number) setSel(r.number);
  };
  const last = k.certificates[k.certificates.length - 1];
  return (
    <div>
      <div className="toolbar">
        <button onClick={() => add("progress")} title={tr("A progress certificate for this month, starting where the last one ended")}>
          {tr("This period")}
        </button>
        <button onClick={() => add("advance")} title={tr("The advance payment's certificate")}>
          {tr("Advance")}
        </button>
        <button onClick={() => add("retention")} title={tr("Gives the guarantee retention back, at the final reception")}>
          {tr("Retention back")}
        </button>
        <button disabled={!last} onClick={() => last && confirm(tr("Delete certificate &1?", last.number)) && w.run("cert.delete", { contract: k.id, cert: last.number })}>
          {tr("Delete last")}
        </button>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>{tr("No.")}</th>
            <th>{tr("Kind")}</th>
            <th>{tr("Period")}</th>
            <th>{tr("Status")}</th>
            <th className="num">{tr("Work")}</th>
            <th className="num">{tr("Adjustment")}</th>
            <th className="num">{tr("Advance")}</th>
            <th className="num">{tr("Retention")}</th>
            <th className="num">{tr("Net")}</th>
          </tr>
        </thead>
        <tbody>
          {k.certificates.map((c: any) => (
            <tr key={c.id} className={"link" + (c.number === sel ? " selected" : "")} onClick={() => setSel(c.number)}>
              <td>{c.number}</td>
              <td>{tr(c.kind)}</td>
              <td>{c.period}</td>
              <td>{tr(c.status)}</td>
              <td className="num">{fmt(c.work)}</td>
              <td className="num">{fmt(c.adjustment)}</td>
              <td className="num">{c.advanceRecovered ? "−" + fmt(c.advanceRecovered) : ""}</td>
              <td className="num">{c.retention ? "−" + fmt(c.retention) : ""}</td>
              <td className="num strong">{fmt(c.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {q && (
        <section>
          <h2>{tr("Certificate &1, &2", q.number, tr(q.kind))}</h2>
          <div className="sheethead">
            <Row label={tr("Period")}>
              <input type="month" value={q.period} onChange={(e) => w.run("cert.set", { contract: k.id, cert: q.number, period: e.target.value })} />
            </Row>
            <Row label={tr("Date")}>
              <input type="date" value={q.date} onChange={(e) => w.run("cert.set", { contract: k.id, cert: q.number, date: e.target.value })} />
            </Row>
            <Row label={tr("Index")}>
              <Num value={q.index} onCommit={(v) => w.run("cert.set", { contract: k.id, cert: q.number, index: v })} onBad={bad} />
            </Row>
            <Row label={tr("Status")}>
              <button onClick={() => w.run("cert.set", { contract: k.id, cert: q.number, status: q.status === "issued" ? "draft" : "issued" })}>
                {q.status === "issued" ? tr("issued: back to draft") : tr("draft: issue it")}
              </button>
            </Row>
            <Row label="PDF">
              <button
                onClick={async () => {
                  const r = await openReport(w.id, { kind: "certificate", contract: k.id, cert: q.number });
                  w.setStatus(r.error ? { text: r.error, error: true } : { text: tr("&1: &2 pages", r.name, r.pages), error: false });
                }}
                title={tr("The certificate in PDF, to print and sign")}
              >
                <img className="icon" src="/icons/document-print.svg" alt="" /> {tr("Certificate")}
              </button>
            </Row>
          </div>
          {q.kind === "progress" && <Measures k={k} q={q} />}
        </section>
      )}
    </div>
  );
}

function Measures({ k, q }: { k: any; q: any }) {
  const w = useWork();
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const i = k.certificates.findIndex((c: any) => c.id === q.id);
  const before = (part: string) => {
    let f = 0;
    for (const c of k.certificates.slice(0, i)) if (c.kind === "progress" && part in c.measures) f = c.measures[part];
    return f;
  };
  const issued = q.status === "issued";
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>{tr("Item")}</th>
          <th>{tr("Description")}</th>
          <th className="num">{tr("Contract")}</th>
          <th className="num">{tr("Before")}</th>
          <th className="num">{tr("Accumulated")}</th>
          <th className="num">{tr("This period")}</th>
          <th className="num">{tr("Amount")}</th>
        </tr>
      </thead>
      <tbody>
        {k.parts.map((p: any) => {
          const b = before(p.id);
          const acc = q.measures[p.id] ?? b;
          return (
            <Fragment key={p.id}>
              <tr>
                <td>{p.code}</td>
                <td>{p.description}</td>
                <td className="num">{qty(p.qty)}</td>
                <td className="num">{qty(b)}</td>
                <td className="num">{issued ? qty(acc) : <Num value={acc} onCommit={(v) => w.run("cert.set", { contract: k.id, cert: q.number, measures: [{ part: p.id, acc: v }] })} onBad={bad} />}</td>
                <td className="num">{qty(acc - b)}</td>
                <td className="num">{fmt((acc - b) * p.unitPrice)}</td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

const MEANS = ["transfer", "cheque", "cash", "other"];

function Payments({ k }: { k: any }) {
  const w = useWork();
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const set = (i: number, field: string, v: unknown) => w.run("payment.set", { contract: k.id, index: i, [field]: v });
  const certOf = (id: string) => k.certificates.find((c: any) => c.id === id)?.number ?? "";
  return (
    <div>
      <table className="grid">
        <thead>
          <tr>
            <th>{tr("Date")}</th>
            <th className="num">{tr("Amount")}</th>
            <th>{tr("Means")}</th>
            <th>{tr("Reference")}</th>
            <th>{tr("Certificate")}</th>
            <th>{tr("Invoice")}</th>
            <th>{tr("Invoice date")}</th>
            <th>{tr("Note")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {k.payments.map((y: any, i: number) => (
            <tr key={y.id}>
              <td>
                <input type="date" value={y.date} onChange={(e) => set(i, "date", e.target.value)} />
              </td>
              <td className="num">
                <Num value={y.amount} onCommit={(v) => set(i, "amount", v)} onBad={bad} />
              </td>
              <td>
                <select value={y.means} onChange={(e) => set(i, "means", e.target.value)}>
                  {MEANS.map((m) => (
                    <option key={m} value={m}>
                      {tr(m)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <Text value={y.reference} onCommit={(v) => set(i, "reference", v)} />
              </td>
              <td>
                <select value={certOf(y.certificate)} onChange={(e) => set(i, "certificate", e.target.value)}>
                  <option value="">{tr("(on account)")}</option>
                  {k.certificates.map((c: any) => (
                    <option key={c.id} value={c.number}>
                      {c.number} · {tr(c.kind)} · {fmt(c.net)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <Text value={y.invoice} onCommit={(v) => set(i, "invoice", v)} />
              </td>
              <td>
                <input type="date" value={y.invoiceDate} onChange={(e) => set(i, "invoiceDate", e.target.value)} />
              </td>
              <td>
                <Text value={y.note} onCommit={(v) => set(i, "note", v)} />
              </td>
              <td className="actions">
                <button title={tr("Delete")} onClick={() => confirm(tr("Delete this payment?")) && w.run("payment.delete", { contract: k.id, index: i })}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="toolbar">
        <button onClick={() => w.run("payment.add", { contract: k.id, amount: Math.max(0, Math.round(k.balance * 100) / 100) })} title={tr("A payment of the balance, today: change what isn't so")}>
          {tr("Add payment")}
        </button>
      </div>
    </div>
  );
}
