// Brings a price library into a price book from CSV files, as Tincho made them from licita2003.xls (port of
// LibraryImport and Csv). It takes the files' contents, not a folder: they come from the library shipped
// with the program (library/licita2003 and library/added) or from files the person uploads.
//   resources.csv       code,name,unit,price,origin,loss,kind          (kind: material, labor, equipment)
//   analyses.csv        code,rubro,name,unit,equipment_yield,labor_yield
//   analysis-items.csv  analysis,resource,quantity
//   rubros.csv          number,name
//   labor.csv           code,category,wage_per_hour,...               (the "mdo" sheet)
//   equipment.csv       number,name,power_hp,cost,residual,life_h,use_h_year,...,fuel,fuel_price,fuel_use,...
// and, if given, the "added" set (the same files, with what was added after the xls).
//
// The library's codes become the items' codes (each gets a new id); an item whose code the book already has
// is updated, nothing is removed. Labor and equipment get their calculation (the wage, the machine); where the
// library's typed price differs from it, the typed price is kept as an override (what the bids used, often
// hand edits) and the report lists them. The mdo sheet's category names win over the resources' (decided with
// the user: 90010 is Sereno).

import { calculatedPrice, EQUIPMENT, hasCalculation, KINDS, LABOR, MATERIAL, newAnalysis, newMachine, newResource, priceOf, type Analysis, type PriceBook, type Resource } from "./prices.ts";
import { tr } from "./text.ts";

/** A set of library files: file name -> its text */
export type LibraryFiles = Record<string, string>;

export const LIBRARY_FILES = ["rubros.csv", "resources.csv", "labor.csv", "equipment.csv", "analyses.csv", "analysis-items.csv"];

// CSV

/** Splits CSV text into rows of fields: comma separated, fields in double quotes may hold commas, newlines
 *  and "" for a quote */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // CRLF: the \n ends the row
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The rows of a CSV as objects keyed by the header's names (blank lines skipped) */
export function readCsv(text: string | undefined): Record<string, string>[] | null {
  if (text === undefined) return null;
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (const r of rows.slice(1)) {
    if (r.length === 1 && r[0] === "") continue;
    const o: Record<string, string> = {};
    header.forEach((h, j) => j < r.length && (o[h] = r[j]));
    out.push(o);
  }
  return out;
}

/** Numbers as written in the CSV ("1.35", "1,35"); "" = 0 */
export function toFloat(v: unknown): number {
  const f = Number(String(v ?? "").trim().replace(",", "."));
  return Number.isFinite(f) ? f : 0;
}

const toInt = (v: unknown) => Math.round(toFloat(v));

/** A code as written in the CSV ("2001", "2001.0") as text; "" if there is none */
export function codeOf(v: unknown): string {
  let s = String(v ?? "").trim();
  if (s === "" || s === "0") return "";
  const m = /^(\d+)\.0*$/.exec(s);
  if (m) s = m[1];
  return s;
}

// THE IMPORT

class Import {
  book: PriceBook;
  report: string[] = [];
  res = new Map<string, Resource>(); // code -> resource of the book
  ana = new Map<string, Analysis>();
  missingName = tr("(missing in the library)");

  constructor(book: PriceBook) {
    this.book = book;
    for (const r of book.resources.values()) this.res.set(r.code, r);
    for (const a of book.analyses.values()) this.ana.set(a.code, a);
  }

  resource(code: string): Resource {
    let r = this.res.get(code);
    if (!r) {
      r = newResource();
      r.code = code;
      this.res.set(code, r);
      this.book.resources.set(r.id, r);
    }
    return r;
  }

  files(f: LibraryFiles, tag: string): void {
    const b = this.book;
    let rows = readCsv(f["rubros.csv"]);
    if (rows) {
      let n = 0;
      for (const c of rows)
        if (toInt(c.number) > 0 && (c.name ?? "").trim()) {
          b.rubros.set(toInt(c.number), c.name.trim());
          n++;
        }
      this.report.push(tr("&1 rubros", n));
    }

    rows = readCsv(f["resources.csv"]);
    if (rows) {
      let n = 0;
      for (const c of rows) {
        const code = codeOf(c.code);
        if (!code) continue;
        const r = this.resource(code);
        r.name = (c.name ?? "").trim();
        r.unit = (c.unit ?? "").trim();
        if (KINDS.includes(c.kind)) r.kind = c.kind;
        if ((c.price ?? "").trim()) {
          r.price = toFloat(c.price);
          r.source = tag;
        }
        if ("origin" in c) r.origin = c.origin.trim();
        if ((c.loss ?? "").trim()) r.loss = toFloat(c.loss);
        n++;
      }
      this.report.push(tr("&1 resources", n));
    }

    // labor categories (the "mdo" sheet): the wage, the name
    rows = readCsv(f["labor.csv"]);
    if (rows) {
      let n = 0;
      for (const c of rows) {
        const code = codeOf(c.code);
        if (!code) continue;
        const r = this.resource(code);
        r.kind = LABOR;
        if (!r.unit) r.unit = "h";
        const cat = (c.category ?? "").trim();
        if (cat && cat.toLowerCase() !== r.name.toLowerCase()) {
          if (r.name) this.report.push(tr("&1: named &2 (it was &3 in the resources)", code, cat, r.name));
          r.name = cat;
        }
        r.wage = toFloat(c.wage_per_hour);
        n++;
      }
      this.report.push(tr("&1 labor categories", n));
    }

    // equipment (the "equ" sheet): its number n prices resource 100000 + n
    rows = readCsv(f["equipment.csv"]);
    if (rows) {
      let n = 0;
      for (const c of rows) {
        if (toInt(c.number) <= 0) continue;
        const r = this.resource(String(100000 + toInt(c.number)));
        r.kind = EQUIPMENT;
        if (!r.name) r.name = (c.name ?? "").trim();
        if (!r.unit) r.unit = "h";
        const m = newMachine();
        m.power = toFloat(c.power_hp);
        m.cost = toFloat(c.cost);
        if (m.cost > 0) m.residualPct = (toFloat(c.residual) / m.cost) * 100;
        if (toFloat(c.life_h) > 0) m.lifeHours = toFloat(c.life_h);
        if (toFloat(c.use_h_year) > 0) m.hoursPerYear = toFloat(c.use_h_year);
        m.fuel = (c.fuel ?? "").trim();
        m.fuelPrice = toFloat(c.fuel_price);
        if (m.power > 0) m.fuelUse = toFloat(c.fuel_use) / m.power; // the csv has liters an hour
        r.machine = m;
        n++;
      }
      this.report.push(tr("&1 machines", n));
    }

    // analyses and their lines
    rows = readCsv(f["analyses.csv"]);
    if (rows) {
      let n = 0;
      for (const c of rows) {
        const code = codeOf(c.code);
        if (!code) continue;
        let a = this.ana.get(code);
        if (a) a.lines = [];
        else {
          a = newAnalysis();
          a.code = code;
          this.ana.set(code, a);
          b.analyses.set(a.id, a);
        }
        a.rubro = toInt(c.rubro);
        a.name = (c.name ?? "").trim();
        a.unit = (c.unit ?? "").trim();
        a.equipmentYield = toFloat(c.equipment_yield) > 0 ? toFloat(c.equipment_yield) : 1;
        a.laborYield = toFloat(c.labor_yield) > 0 ? toFloat(c.labor_yield) : 1;
        n++;
      }
      this.report.push(tr("&1 analyses", n));
    }

    rows = readCsv(f["analysis-items.csv"]);
    if (rows) {
      let n = 0;
      let bad = 0;
      for (const c of rows) {
        const a = this.ana.get(codeOf(c.analysis));
        if (!a) {
          bad++;
          continue;
        }
        const code = codeOf(c.resource);
        let r = this.res.get(code);
        if (!r) {
          // a resource the library doesn't have: made empty, so the line is kept and the problem shows
          r = this.resource(code);
          r.name = this.missingName;
        }
        a.lines.push({ isAnalysis: false, ref: r.id, qty: toFloat(c.quantity) });
        n++;
      }
      this.report.push(tr("&1 analysis lines", n));
      if (bad) this.report.push(tr("&1 lines of analyses that don't exist were skipped", bad));
    }
  }

  /** Labor and equipment whose typed price differs from the calculation keep the typed one as an override */
  keepTypedPrices(): void {
    const b = this.book;
    const lines: string[] = [];
    for (const r of b.resources.values()) {
      if (r.kind === MATERIAL || !hasCalculation(r)) continue;
      const calc = calculatedPrice(b, r);
      if (r.price > 0 && Math.abs(calc - r.price) > 0.005) {
        r.override = true;
        lines.push(`${r.code} ${r.name}: ${r.price.toFixed(2)} / ${calc.toFixed(2)}`);
      } else r.override = false;
    }
    if (lines.length) this.report.push(tr("&1 labor and equipment prices were typed over their calculation and are kept as overrides (typed / calculated):", lines.length), ...lines);
  }

  /** Resources the analyses use but the library doesn't have, and resources without a price */
  reportMissing(): void {
    const missing: string[] = [];
    let noPrice = 0;
    for (const r of this.book.resources.values()) {
      if (r.name === this.missingName) missing.push(r.code);
      else if (priceOf(this.book, r) === 0) noPrice++;
    }
    if (missing.length) this.report.push(tr("&1 resources used by analyses are missing in the library, made empty: &2", missing.length, missing.join(", ")));
    if (noPrice) this.report.push(tr("&1 resources have no price", noPrice));
  }
}

/** Imports a library (and its added files) into book. The report says what it did; error if nothing could be read. */
export function importLibrary(book: PriceBook, files: LibraryFiles, name: string, added?: LibraryFiles): { report: string[]; error?: string } {
  if (files["resources.csv"] === undefined && files["analyses.csv"] === undefined) return { report: [], error: tr("&1 has no resources.csv or analyses.csv.", name) };
  const x = new Import(book);
  x.files(files, name);
  if (added && Object.keys(added).length) {
    x.report.push(tr("From the added folder:"));
    x.files(added, "added");
  }
  book.source = name;
  x.keepTypedPrices();
  x.reportMissing();
  return { report: x.report };
}
