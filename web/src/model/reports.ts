// The PDF reports (decided with the user 2026-11-17: the outputs are PDF, all of them): the budget by rubro, its
// summary, the analyses it uses (licita2003's A B C D layout), the Gantt, and a contract's certificate.
// (Port of Reports.module; the texts are its own, so the Spanish is shared.) Numbers and dates are written in
// the language of the catalog loaded (see text.ts).

import * as B from "./budget.ts";
import { findContractor, type Company } from "./company.ts";
import { findCert, findContract, measuredBefore, numbers, PROGRESS } from "./contracts.ts";
import { PdfDoc } from "./pdf.ts";
import * as P from "./prices.ts";
import { addDays } from "./dates.ts";
import { isWorkDay, type Project } from "./project.ts";
import * as S from "./schedule.ts";
import { locale, today, tr } from "./text.ts";

export const REPORT_KINDS = ["budget", "summary", "analyses", "gantt", "certificate"];

const MARGIN = 15;
const LINE_H = 4.6; // mm a table row

export interface ReportResult {
  pdf?: Uint8Array;
  name?: string; // a file name for it
  pages?: number;
  error?: string;
}

/** Makes the report kind; for a certificate, contract and cert say which (id, code or number) */
export function makeReport(p: Project, company: Company, kind: string, contract = "", cert = ""): ReportResult {
  const r = new Report(p);
  let why: string;
  let name = kind;
  switch (kind) {
    case "budget":
      why = r.budget(false);
      name = tr("Budget");
      break;
    case "summary":
      why = r.budget(true);
      name = tr("Budget summary");
      break;
    case "analyses":
      why = r.analyses();
      name = tr("Unit price analyses");
      break;
    case "gantt":
      why = r.gantt();
      name = tr("Gantt");
      break;
    case "certificate":
      why = r.certificate(company, contract, cert);
      name = r.title;
      break;
    default:
      return { error: tr("Unknown report &1.", kind) };
  }
  if (why) return { error: why };
  r.pdf.footer = tr("Page &1 of &2") + " - sumi-contract - " + r.workTitle;
  const pages = r.pdf.pageCount();
  return { pdf: r.pdf.bytes(), pages, name: `${r.workTitle} - ${name}.pdf`.replace(/[\\/:*?"<>|]/g, "_") };
}

// FORMATS

function fmt(f: number, min: number, max = min, grouping = true): string {
  return f.toLocaleString(locale(), { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: grouping ? "always" : false });
}
const money = (f: number) => fmt(f, 2);
const quantity = (f: number) => fmt(f, 1, 4);
function share(part: number, whole: number): string {
  return whole === 0 ? "" : fmt((part / whole) * 100, 1) + "%";
}
/** yyyy-mm-dd as dd/mm/yyyy (or dd/mm/yy when short) */
function day(d: string, short = false): string {
  if (!/^\d{4}-\d\d-\d\d$/.test(d)) return d;
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${short ? d.slice(2, 4) : d.slice(0, 4)}`;
}

class Report {
  p: Project;
  pdf = new PdfDoc();
  title = "";
  workTitle: string;
  private y = 0; // where the next row goes
  private cols: number[] = []; // x of each column (left edge)
  private widths: number[] = [];
  private align: string[] = [];
  private heads: string[] | null = null;

  constructor(p: Project) {
    this.p = p;
    this.workTitle = p.name || tr("Untitled");
  }

  // THE PAGE

  private start(title: string, landscape = false): void {
    this.pdf = new PdfDoc(landscape);
    this.title = title;
    this.newPage();
  }

  /** A new page with the header: the work, the client, the title, the date */
  private newPage(): void {
    const p = this.p;
    const w = this.pdf.pageW();
    this.pdf.newPage();
    this.pdf.text(MARGIN, 14, this.workTitle, 13, true);
    this.pdf.text(w - MARGIN, 14, this.title, 11, true, "r");
    this.pdf.text(MARGIN, 19, (p.client + (p.client && p.location ? " - " : "") + p.location + (p.city ? ", " + p.city : "")).trim(), 8.5);
    this.pdf.text(w - MARGIN, 19, day(today()), 8.5, false, "r");
    this.pdf.line(MARGIN, 21.5, w - MARGIN, 21.5, 0.4);
    this.y = 28;
    if (this.heads?.length) this.headRow();
  }

  /** Room for h mm more, or a new page */
  private need(h: number): void {
    if (this.y + h > this.pdf.pageH() - 14) this.newPage();
  }

  /** A table: column titles, widths in mm (0 = the rest), alignments */
  private table(heads: string[], widths: number[], align: string[]): void {
    this.heads = heads;
    this.align = align;
    const rest = this.pdf.pageW() - 2 * MARGIN - widths.reduce((a, b) => a + b, 0);
    this.widths = widths.map((w) => (w > 0 ? w : rest));
    this.cols = [];
    let x = MARGIN;
    for (const w of this.widths) {
      this.cols.push(x);
      x += w;
    }
    this.need(LINE_H * 3);
    this.headRow();
  }

  private headRow(): void {
    this.pdf.box(MARGIN, this.y - 3.6, this.pdf.pageW() - 2 * MARGIN, LINE_H + 0.4, 0xdde4ee);
    this.heads!.forEach((h, i) => this.cell(i, h, true));
    this.y += LINE_H + 0.6;
  }

  private cell(i: number, text: string, bold = false): void {
    const size = 8;
    const s = this.pdf.fit(text, this.widths[i] - 1.5, size, bold);
    if (this.align[i] === "r") this.pdf.text(this.cols[i] + this.widths[i] - 0.8, this.y, s, size, bold, "r");
    else if (this.align[i] === "c") this.pdf.text(this.cols[i] + this.widths[i] / 2, this.y, s, size, bold, "c");
    else this.pdf.text(this.cols[i] + 0.8, this.y, s, size, bold, "l");
  }

  /** A row of the table; bold for titles and totals, a band behind when band >= 0 */
  private row(cells: string[], bold = false, band = -1): void {
    this.need(LINE_H);
    if (band >= 0) this.pdf.box(MARGIN, this.y - 3.4, this.pdf.pageW() - 2 * MARGIN, LINE_H, band);
    for (let i = 0; i < Math.min(cells.length, this.cols.length); i++) this.cell(i, cells[i], bold);
    this.y += LINE_H;
  }

  private endTable(): void {
    this.heads = null;
  }

  private gap(h = 3): void {
    this.y += h;
  }

  private note(text: string, size = 8, bold = false): void {
    this.need(LINE_H);
    this.pdf.text(MARGIN, this.y, text, size, bold);
    this.gap(LINE_H);
  }

  // THE BUDGET (summary: only the rubros)

  budget(summary: boolean): string {
    const p = this.p;
    const h = p.budget;
    if (h.items.length === 0) return tr("The budget has no items.");
    const all = B.totals(p);
    const rubroName = (n: number) => p.prices.rubros.get(n) ?? "";
    if (summary) {
      this.start(tr("Budget summary"));
      this.table([tr("Rubro"), tr("Description"), tr("Direct cost"), tr("Price"), "%"], [14, 0, 30, 32, 16], ["l", "l", "r", "r", "r"]);
      for (const n of B.usedRubros(h)) {
        const f = B.totals(p, n);
        this.row([String(n), rubroName(n), money(f[0]), money(f[1]), share(f[1], all[1])]);
      }
    } else {
      this.start(tr("Budget"), true);
      this.table([tr("Item"), tr("Description"), tr("Unit"), tr("Quantity"), tr("Unit price"), tr("Total"), "%"], [16, 0, 14, 26, 30, 34, 16], ["l", "l", "c", "r", "r", "r", "r"]);
      for (const n of B.usedRubros(h)) {
        const f = B.totals(p, n);
        this.need(LINE_H * 3);
        this.row([String(n), rubroName(n), "", "", "", money(f[1]), share(f[1], all[1])], true, 0xeef1f5);
        for (const b of h.items) {
          if (b.rubro !== n) continue;
          const total = B.itemTotal(p, b);
          this.row([b.code, B.descriptionOf(p, b), B.unitOf(p, b), money(b.qty), money(B.itemUnitPrice(p, b)), money(total), share(total, all[1])]);
        }
      }
    }
    this.gap(1);
    this.pdf.line(MARGIN, this.y - 3.8, this.pdf.pageW() - MARGIN, this.y - 3.8, 0.3);
    if (summary) this.row(["", tr("Total") + " (" + p.currency + ")", money(all[0]), money(all[1]), ""], true);
    else {
      this.row(["", tr("Direct cost"), "", "", "", money(all[0]), ""], true);
      this.row(["", tr("Total price") + " (" + p.currency + ")", "", "", "", money(all[1]), ""], true);
    }
    this.endTable();
    this.gap();
    this.need(LINE_H * 6);
    this.note(tr("From cost to price"), 9, true);
    this.note(tr("General expenses &1%, profit &2%, taxes &3%: × &4", fmt(p.overheadPct, 0, 2), fmt(p.profitPct, 0, 2), fmt(p.taxesPct, 0, 2), fmt(p.priceFactor, 4)));
    for (const n of B.usedRubros(h)) for (const k of B.coefsOf(h, n)) this.note(tr("Rubro &1: &2 &3%", n, k.name, fmt(k.pct, 0, 2)));
    for (const b of h.items) for (const k of b.coefs) this.note(tr("Item &1: &2 &3%", b.code, k.name, fmt(k.pct, 0, 2)));
    const area = p.coveredArea + p.semiCoveredArea / 2;
    if (area > 0) this.note(tr("&1 &2 a m² (&3 m²)", p.currency, fmt(all[1] / area, 0), money(area)), 8, true);
    return "";
  }

  // THE ANALYSES THE BUDGET USES (with their sub-analyses), as licita2003's sheet

  analyses(): string {
    const b = this.p.prices;
    const ids: string[] = [];
    const add = (id: string, depth: number) => {
      const a = b.analyses.get(id);
      if (!a || ids.includes(id) || depth > P.MAX_DEPTH) return;
      ids.push(id);
      for (const l of a.lines) if (l.isAnalysis) add(l.ref, depth + 1);
    };
    for (const item of this.p.budget.items) if (item.analysis) add(item.analysis, 0);
    // no budget yet: every analysis of the price book
    if (ids.length === 0) for (const a of P.sortedByCode(b.analyses.values())) ids.push(a.id);
    if (ids.length === 0) return tr("There are no analyses.");
    this.start(tr("Unit price analyses"));
    for (const id of ids) this.oneAnalysis(b.analyses.get(id)!);
    return "";
  }

  private oneAnalysis(a: P.Analysis): void {
    const b = this.p.prices;
    const f = P.parts(b, a);
    const groups = [P.MATERIAL, P.EQUIPMENT, P.LABOR, "analysis"];
    const titles = [tr("A - Materials"), tr("B - Equipment"), tr("C - Labor"), tr("Sub-analyses")];
    const w = this.pdf.pageW();
    this.need(LINE_H * 8);
    this.pdf.box(MARGIN, this.y - 4, w - 2 * MARGIN, 6, 0xdde4ee);
    this.pdf.text(MARGIN + 1, this.y, this.pdf.fit(a.code + "  " + a.name, w - 2 * MARGIN - 50, 9.5, true), 9.5, true);
    this.pdf.text(w - MARGIN - 1, this.y, tr("Unit") + ": " + a.unit + "   " + tr("Rubro") + ": " + a.rubro, 8.5, false, "r");
    this.gap(LINE_H + 1.5);
    if (a.laborYield !== 1 || a.equipmentYield !== 1) this.note(tr("Labor yield &1, equipment yield &2", quantity(a.laborYield), quantity(a.equipmentYield)));
    this.table([tr("Code"), tr("Description"), tr("Quantity"), tr("Unit"), tr("Unit price"), tr("Total")], [18, 0, 22, 14, 26, 28], ["l", "l", "r", "c", "r", "r"]);
    groups.forEach((g, i) => {
      let any = false;
      for (const l of a.lines) {
        const r = l.isAnalysis ? undefined : b.resources.get(l.ref);
        if (l.isAnalysis ? g !== "analysis" : !r || r.kind !== g) continue;
        if (!any) {
          this.row(["", titles[i], "", "", "", ""], true);
          any = true;
        }
        if (l.isAnalysis) {
          const n = b.analyses.get(l.ref);
          if (n) this.row([n.code, n.name, quantity(l.qty), n.unit, money(P.direct(b, n)), money(P.lineCost(b, a, l))]);
        } else this.row([r!.code, r!.name, quantity(l.qty), r!.unit, money(P.priceOf(b, r!)), money(P.lineCost(b, a, l))]);
      }
    });
    this.endTable();
    this.need(LINE_H * 3);
    const d = f[0] + f[1] + f[2];
    this.pdf.text(w - MARGIN, this.y, tr("A &1 + B &2 + C &3 = D direct cost &4", money(f[0]), money(f[1]), money(f[2]), money(d)), 8.5, true, "r");
    this.gap(LINE_H);
    this.pdf.text(w - MARGIN, this.y, tr("Price = D × &1 = &2", fmt(this.p.priceFactor, 4), money(d * this.p.priceFactor)), 8.5, true, "r");
    this.gap(LINE_H * 2);
  }

  // THE GANTT

  gantt(): string {
    const p = this.p;
    const s = p.schedule;
    const h = p.budget;
    if (h.items.length === 0) return tr("The budget has no items.");
    if (S.compute(p)) return s.problem;
    if (s.length <= 0) return tr("The tasks have no days.");
    // the date of every working day, once
    const dates: string[] = [S.dateOf(p, 0)];
    for (let i = 1; i <= Math.ceil(s.length); i++) dates.push(nextWorkDay(p, dates[i - 1]));
    const dateOf = (n: number) => dates[Math.max(0, Math.min(dates.length - 1, Math.trunc(n)))];
    this.start(tr("Gantt"), true);
    this.table([tr("Item"), tr("Task"), tr("Days"), tr("Start"), tr("End"), ""], [14, 70, 12, 18, 18, 0], ["l", "l", "r", "c", "c", "l"]);
    const x0 = this.cols[5] + 1;
    const scale = (this.widths[5] - 2) / s.length;
    // the months over the bars
    for (let i = 0; i <= Math.trunc(s.length); i++)
      if (i === 0 || dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7)) this.pdf.text(x0 + i * scale, this.y - 5.2, dates[i].slice(5, 7) + "/" + dates[i].slice(2, 4), 6, false, "l", 0x606060);
    const days = (f: number) => fmt(f, 0, 1, false);
    for (const n of B.usedRubros(h)) {
      const f = S.rubroSpan(p, n);
      this.need(LINE_H * 2);
      this.row([String(n), p.prices.rubros.get(n) ?? "", days(f[1] - f[0]), day(dateOf(f[0]), true), day(dateOf(Math.max(f[0], f[1] - 1)), true), ""], true, 0xeef1f5);
      this.pdf.box(x0 + f[0] * scale, this.y - LINE_H - 2.2, Math.max(0.4, (f[1] - f[0]) * scale), 1.6, 0x333333);
      for (const b of h.items) {
        if (b.rubro !== n) continue;
        const t = s.tasks.get(b.id);
        if (!t) continue;
        this.row([b.code, B.descriptionOf(p, b), days(t.days), day(dateOf(t.earlyStart), true), day(dateOf(Math.max(t.earlyStart, t.earlyFinish - 1)), true), ""]);
        this.pdf.box(x0 + t.earlyStart * scale, this.y - LINE_H - 3, Math.max(0.4, t.days * scale), 2.8, S.critical(t) ? 0xd03030 : 0x4a7cc2);
        const done = S.doneOf(p, b);
        if (done > 0) this.pdf.box(x0 + t.earlyStart * scale, this.y - LINE_H - 2, Math.max(0.3, t.days * scale * done), 0.8, 0x000000);
      }
    }
    this.endTable();
    this.gap();
    this.need(LINE_H * 2);
    this.note(tr("&1 working days, from &2 to &3. Red: the critical path. Black line: certified progress.", days(s.length), day(dateOf(0)), day(dateOf(Math.max(0, s.length - 1)))));
    return "";
  }

  // A CERTIFICATE

  certificate(company: Company, contract: string, cert: string): string {
    const p = this.p;
    const t = findContract(p.contracts, contract);
    if (!t) return tr("There is no contract &1.", contract);
    const q = findCert(t, cert);
    if (!q) return tr("Contract &1 has no certificate &2.", t.code, cert);
    const k = findContractor(company, t.contractor);
    const f = numbers(t, q);
    const w = this.pdf.pageW();
    this.start(tr("Certificate &1 - &2", q.number, t.code));
    let who = "?";
    if (k) {
      who = k.name;
      if (k.taxId) who += "  " + tr("Tax id") + " " + k.taxId;
    }
    this.note(tr("Contractor") + ": " + who, 9, true);
    this.note(tr("Contract &1: &2. Period &3, date &4. Kind: &5. &6", t.code, t.title, q.period, day(q.date), tr(q.kind), q.status === "issued" ? tr("Issued") : tr("DRAFT")), 8.5);
    this.gap(LINE_H * 0.5);
    if (q.kind === PROGRESS) {
      this.table([tr("Item"), tr("Description"), tr("Unit"), tr("Contract"), tr("Before"), tr("This period"), tr("Accumulated"), tr("Price"), tr("Amount")], [13, 0, 11, 20, 19, 19, 20, 22, 26], ["l", "l", "c", "r", "r", "r", "r", "r", "r"]);
      for (const r of t.parts) {
        const b = B.findItem(p.budget, r.item);
        const before = measuredBefore(t, q, r.id);
        const acc = r.id in q.measures ? q.measures[r.id] : before;
        this.row([b ? b.code : "", b ? B.descriptionOf(p, b) : tr("(the budget item is gone)"), b ? B.unitOf(p, b) : "", money(r.qty), money(before), money(acc - before), money(acc), money(r.unitPrice), money((acc - before) * r.unitPrice)]);
      }
      this.endTable();
      this.gap();
    }
    this.need(LINE_H * 8);
    this.amount(tr("Work of the period"), f[0]);
    if (t.baseIndex > 0 && q.index > 0) this.amount(tr("Adjustment: &1 &2 / &3 - 1", t.indexName, fmt(q.index, 0, 4), fmt(t.baseIndex, 0, 4)), f[1]);
    if (f[2]) this.amount(tr("Advance recovered (&1%)", fmt(t.advancePct, 0, 2)), -f[2]);
    if (f[3]) this.amount(tr("Guarantee retention (&1%)", fmt(t.retentionPct, 0, 2)), -f[3]);
    this.pdf.line(w - MARGIN - 70, this.y - 3.6, w - MARGIN, this.y - 3.6, 0.3);
    this.amount(tr("Net to pay") + " (" + p.currency + ")", f[4], true);
    this.gap(LINE_H * 4);
    this.need(LINE_H * 4);
    this.pdf.line(MARGIN, this.y, MARGIN + 60, this.y, 0.2);
    this.pdf.line(w - MARGIN - 60, this.y, w - MARGIN, this.y, 0.2);
    this.gap(LINE_H);
    this.pdf.text(MARGIN + 30, this.y, tr("Site direction"), 8, false, "c");
    this.pdf.text(w - MARGIN - 30, this.y, tr("Contractor"), 8, false, "c");
    return "";
  }

  private amount(what: string, f: number, bold = false): void {
    const w = this.pdf.pageW();
    this.pdf.text(w - MARGIN - 40, this.y, what, 9, bold, "r");
    this.pdf.text(w - MARGIN, this.y, money(f), 9, bold, "r");
    this.gap(LINE_H + 0.4);
  }
}

/** The working day after d */
function nextWorkDay(p: Project, d: string): string {
  if (p.workDaysPerWeek < 1) return d;
  do d = addDays(d, 1);
  while (!isWorkDay(p, d));
  return d;
}
