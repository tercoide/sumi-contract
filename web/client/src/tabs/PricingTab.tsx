// The Pricing tab (port of FPricing): the project's price book. Top: import a library, the update coefficient
// and the freight. Pages: Analyses (the list and the selected one as licita2003's sheet), Resources (every
// resource, edited in place, and the machine calculation of an equipment), Labor charges and Rubros.

import { useRef, useState } from "react";
import { Num, Row } from "../fields.tsx";
import { tr } from "../tr.ts";
import { useCommand, useWork } from "../work.ts";
import { AnalysesPage } from "./pricing/AnalysesPage.tsx";
import { ResourcesPage } from "./pricing/ResourcesPage.tsx";
import { ChargesPage, RubrosPage } from "./pricing/BookPages.tsx";

const PAGES = [
  { id: "analyses", label: () => tr("Analyses") },
  { id: "resources", label: () => tr("Resources") },
  { id: "charges", label: () => tr("Labor charges") },
  { id: "rubros", label: () => tr("Rubros") },
];

export function PricingTab() {
  const w = useWork();
  const book = useCommand(w, "book.get");
  const [page, setPage] = useState(() => sessionStorage.getItem("sumi.pricing.page") || "analyses");
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<string[] | null>(null);
  if (!book) return <p className="muted">…</p>;
  if (book.error) return <p className="error">{book.error}</p>;
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const go = (p: string) => {
    sessionStorage.setItem("sumi.pricing.page", p);
    setPage(p);
  };

  return (
    <div>
      <div className="toolbar">
        <button onClick={() => setImporting(!importing)}>{tr("Import library...")}</button>
        <span className="muted">{tr("&1 analyses, &2 resources&3", book.analyses, book.resources, book.source ? ` (${book.source})` : "")}</span>
        <span className="grow" />
        <label className="inline" title={tr("Every unit price is multiplied by it (licita2003's coeficiente interno)")}>
          {tr("Update coefficient")} <Num value={book.updateCoef} width="6em" onCommit={(v) => w.run("book.set", { updateCoef: v })} onBad={bad} />
        </label>
        <label className="inline" title={tr("What a truck costs a km (freight = this × distance / truck load)")}>
          {tr("Freight $/km")} <Num value={book.freightPerKm} width="6em" onCommit={(v) => w.run("book.set", { freightPerKm: v })} onBad={bad} />
        </label>
      </div>
      {importing && (
        <ImportPanel
          done={(r) => {
            setImporting(false);
            setReport(r);
          }}
        />
      )}
      {report && (
        <section className="report">
          <h2>
            {tr("Library imported")} <button onClick={() => setReport(null)}>×</button>
          </h2>
          <pre>{report.join("\n")}</pre>
        </section>
      )}
      <nav className="subtabs">
        {PAGES.map((p) => (
          <button key={p.id} className={p.id === page ? "on" : ""} onClick={() => go(p.id)}>
            {p.label()}
          </button>
        ))}
      </nav>
      {page === "analyses" && <AnalysesPage rubros={book.rubros} />}
      {page === "resources" && <ResourcesPage />}
      {page === "charges" && <ChargesPage charges={book.charges} total={book.chargesPct} />}
      {page === "rubros" && <RubrosPage rubros={book.rubros} />}
    </div>
  );
}

/** Importing a library: the licita2003 one shipped with the program, or CSV files the person has */
function ImportPanel({ done }: { done: (report: string[]) => void }) {
  const w = useWork();
  const [added, setAdded] = useState(true);
  const files = useRef<HTMLInputElement>(null);
  const finish = (r: Record<string, any>) => !r.error && done(r.report);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const f: Record<string, string> = {};
    for (const file of Array.from(list)) f[file.name] = await file.text();
    finish(await w.run("prices.import", { files: f, name: list[0].webkitRelativePath?.split("/")[0] || tr("uploaded files") }));
  };

  return (
    <section>
      <h2>{tr("Import library...")}</h2>
      <p className="muted">{tr("Brings resources, analyses and rubros from a CSV library (licita2003 as Tincho converted it). What the project already has with the same code is updated; nothing is removed; it can be undone.")}</p>
      <Row label="licita2003">
        <span className="inline">
          <button onClick={async () => finish(await w.run("prices.import", { library: "licita2003", added }))}>{tr("Import licita2003")}</button>
          <label className="inline">
            <input type="checkbox" checked={added} onChange={(e) => setAdded(e.target.checked)} /> {tr("with what was added after the xls")}
          </label>
        </span>
      </Row>
      <Row label={tr("Other files")}>
        <span className="inline">
          <button onClick={() => files.current?.click()}>{tr("Choose the CSV files...")}</button>
          <span className="muted small">resources.csv, analyses.csv, analysis-items.csv, rubros.csv, labor.csv, equipment.csv</span>
        </span>
      </Row>
      <input ref={files} type="file" multiple accept=".csv,text/csv" hidden onChange={(e) => upload(e.target.files)} />
    </section>
  );
}
