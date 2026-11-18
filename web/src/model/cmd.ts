// The commands: the one way to change a project or the company's data. The screens, the AI and imports all
// call run, so the AI can do whatever a person can, and every change is written to the change log: who, when,
// how (via), the command and its arguments, and the touched things before and after. (Port of Cmd.module.)
//
// run(session, command, args) returns {ok: true, ...results} or {error: "why"}. Arguments and results are
// JSON, so they go to the AI and over HTTP as they are. Things are named by id or by code ("key").
//
// Undo puts back the before of the caller's last change (a whole group: an AI turn, an import), as a new
// "undo" entry: the log only grows. Redo undoes that undo. A change made later by someone else to the same
// thing blocks the undo (it would erase their work).
//
// A command checks everything before it changes anything; if it fails anyway after touching something, what
// it touched is put back (the Gambas version didn't).

import * as B from "./budget.ts";
import { changeToJson, newChange, type Change, type Who } from "./change.ts";
import * as Co from "./company.ts";
import * as K from "./contracts.ts";
import { todayDay } from "./dates.ts";
import * as P from "./prices.ts";
import { CERTIFICATE_PERIODS, CONTRACT_MODES, endDate, fieldsToJson, PROJECT_FIELDS, setFields, USAGES, WORK_TYPES, type Project } from "./project.ts";
import * as S from "./schedule.ts";
import { isObj, num, str, tr } from "./text.ts";
import { makeId } from "./ids.ts";

export const ABSENT = "~absent~"; // a snapshot of something that didn't exist
export const COALESCE_SECONDS = 120; // edits of the same field in a row become one change

export type Args = Record<string, unknown>;
export type Result = Record<string, unknown>;

/** Who is working, on what. The server keeps one per person and open project. */
export interface Session {
  project: Project | null;
  company: Company;
  who: Who;
  group: string; // the action being made (beginGroup), or ""
  /** Called after a change is logged: what must be saved */
  changed?: (what: "project" | "company") => void;
  /** Extra commands (prices.import, design.*, report.pdf) the server adds, with what they need */
  extra?: Record<string, (x: Op, c: Args) => Result>;
  // the change being made
  pending?: Change | null;
  depth?: number;
}

type Company = Co.Company;

export const ok = (c: Result = {}): Result => ({ ...c, ok: true });
export const fail = (why: string): Result => ({ error: why });

/** The changes until endGroup are one action (undone together) */
export function beginGroup(s: Session): void {
  s.group = makeId("g");
}

export function endGroup(s: Session): void {
  s.group = "";
}

// THE ENTRY POINT

export function run(s: Session, command: string, args?: Args): Result {
  const c: Args = isObj(args) ? args : {};
  const x = new Op(s);
  let out: Result;
  s.depth = (s.depth ?? 0) + 1;
  try {
    out = dispatch(x, command.toLowerCase(), c);
  } catch (e) {
    out = fail(e instanceof Error ? e.message : String(e));
  }
  s.depth--;
  if ("error" in out) {
    if (s.depth === 0 && s.pending) {
      // put back what it touched
      for (const t of s.pending.targets) restore(s, t, s.pending.before[t]);
      s.pending = null;
    }
  } else if (s.pending && s.depth === 0) finish(s);
  return out;
}

/** What a command handler gets: the session, and how to log */
export class Op {
  s: Session;
  constructor(s: Session) {
    this.s = s;
  }
  get p(): Project {
    if (!this.s.project) throw new Error(tr("There is no project open."));
    return this.s.project;
  }
  get co(): Company {
    return this.s.company;
  }
  /** A change starts: who, the command, the arguments, the summary */
  start(command: string, args: Args, summary: string): void {
    const s = this.s;
    if (s.pending) {
      // a command inside another one: it is part of it
      if (summary) s.pending.summary += "; " + summary;
      return;
    }
    s.pending = newChange(s.who, command, structuredClone(args), summary, s.group);
  }
  /** target is about to change: its before is kept (once) */
  touch(target: string): void {
    const h = this.s.pending;
    if (!h || h.targets.includes(target)) return;
    h.targets.push(target);
    h.before[target] = snapshot(this.s, target);
  }
}

function finish(s: Session): void {
  const h = s.pending!;
  s.pending = null;
  for (const t of h.targets) if (t !== "prices") h.after[t] = snapshot(s, t);
  // the company's data has its own log
  if (isCompany(h)) {
    s.company.changes.push(h);
    s.changed?.("company");
    return;
  }
  const p = s.project!;
  const last = p.changes[p.changes.length - 1];
  if (last && canCoalesce(last, h)) {
    // the same field edited again (typing in a box): one change
    last.after = h.after;
    last.args = h.args;
    last.summary = h.summary;
    last.when = h.when;
  } else p.changes.push(h);
  p.modified = h.when;
  s.changed?.("project");
}

/** Does a change touch only the company's data (contractors, the standard library)? */
export function isCompany(h: Change): boolean {
  return h.targets.length > 0 && h.targets.every((t) => t.startsWith("contractor:") || t === "standard");
}

function stampTime(s: string): number {
  return new Date(s.replace(" ", "T")).getTime();
}

function canCoalesce(last: Change, h: Change): boolean {
  if (!h.command.includes(".set")) return false;
  if (last.command !== h.command || last.userId !== h.userId || last.via !== h.via) return false;
  if (last.undoneBy || last.undoOf || h.group || last.group) return false;
  if (last.targets.join() !== h.targets.join()) return false;
  if ((stampTime(h.when) - stampTime(last.when)) / 1000 > COALESCE_SECONDS) return false;
  const k1 = Object.keys(last.args);
  const k2 = Object.keys(h.args);
  if (k1.length !== k2.length || !k2.every((k) => k in last.args)) return false;
  if ("index" in h.args && last.args.index !== h.args.index) return false;
  return true;
}

// SNAPSHOTS

/** The state of a target, as JSON (ABSENT if it doesn't exist) */
export function snapshot(s: Session, target: string): unknown {
  const co = s.company;
  if (target.startsWith("contractor:")) {
    const k = co.contractors.get(target.slice(11));
    return k ? Co.contractorToJson(k) : ABSENT;
  }
  if (target === "standard") return co.standard ? P.bookToJson(co.standard) : ABSENT;
  const p = s.project;
  if (!p) return ABSENT;
  const b = p.prices;
  if (target.startsWith("resource:")) {
    const r = b.resources.get(target.slice(9));
    return r ? P.resourceToJson(r) : ABSENT;
  }
  if (target.startsWith("analysis:")) {
    const a = b.analyses.get(target.slice(9));
    return a ? P.analysisToJson(a) : ABSENT;
  }
  switch (target) {
    case "contracts":
      return K.contractsToJson(p.contracts);
    case "budget":
      return B.budgetToJson(p.budget);
    case "schedule":
      return S.scheduleToJson(p.schedule);
    case "project":
      return fieldsToJson(p);
    case "book":
      return { updateCoef: b.updateCoef, freightPerKm: b.freightPerKm, source: b.source };
    case "rubros":
      return P.rubrosToJson(b);
    case "charges":
      return b.charges.map(P.chargeToJson);
    case "prices":
      return P.bookToJson(b);
  }
  return ABSENT;
}

const isAbsent = (v: unknown) => v === ABSENT || v === null || v === undefined;

/** Puts a target back as a snapshot says */
export function restore(s: Session, target: string, v: unknown): void {
  const co = s.company;
  if (target.startsWith("contractor:")) {
    const id = target.slice(11);
    if (isAbsent(v)) co.contractors.delete(id);
    else co.contractors.set(id, Co.contractorFromJson(v));
    return;
  }
  if (target === "standard") {
    co.standard = isAbsent(v) ? null : P.bookFromJson({ ...P.newBook(), charges: [] }, v);
    return;
  }
  const p = s.project;
  if (!p) return;
  const b = p.prices;
  if (target.startsWith("resource:")) {
    const id = target.slice(9);
    if (isAbsent(v)) b.resources.delete(id);
    else b.resources.set(id, P.resourceFromJson(v));
    return;
  }
  if (target.startsWith("analysis:")) {
    const id = target.slice(9);
    if (isAbsent(v)) b.analyses.delete(id);
    else b.analyses.set(id, P.analysisFromJson(v));
    return;
  }
  const o = isObj(v) ? v : {};
  switch (target) {
    case "contracts":
      p.contracts = K.contractsFromJson(v);
      break;
    case "budget":
      p.budget = B.budgetFromJson(v);
      break;
    case "schedule":
      p.schedule = S.scheduleFromJson(v);
      break;
    case "project": {
      const f: Args = {};
      for (const k of PROJECT_FIELDS) if (k in o) f[k] = o[k];
      setFields(p, f);
      break;
    }
    case "book":
      b.updateCoef = num(o.updateCoef, "updateCoef");
      b.freightPerKm = num(o.freightPerKm, "freightPerKm");
      b.source = str(o.source);
      break;
    case "rubros":
      P.rubrosFromJson(b, v);
      break;
    case "charges":
      b.charges = Array.isArray(v) ? v.map(P.chargeFromJson) : [];
      break;
    case "prices":
      p.prices = P.bookFromJson({ ...P.newBook(), charges: [] }, v);
      break;
  }
}

/** JSON with the keys sorted, to compare snapshots whatever order their keys came in (and null = "", as the
 *  Gambas version writes an empty text) */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x === null ? "" : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

const sameSnapshot = (a: unknown, b: unknown) => canonical(isAbsent(a) ? ABSENT : a) === canonical(isAbsent(b) ? ABSENT : b);

// UNDO AND REDO

/** Undo the caller's last action; or (redo) undo the caller's last undo, if nothing of theirs came after it.
 *  The project's log and the company's are searched, and the newest wins. */
function undo(x: Op, redo: boolean): Result {
  const s = x.s;
  const hp = s.project ? findUndo(s, s.project.changes, redo) : undefined;
  const hc = findUndo(s, s.company.changes, redo);
  if (hc && (!hp || hc.id > hp.id)) return undoIn(s, s.company.changes, hc, redo, true); // ids sort by creation
  if (hp) return undoIn(s, s.project!.changes, hp, redo, false);
  return fail(redo ? tr("Nothing to redo.") : tr("Nothing to undo."));
}

/** The caller's change to undo in a log (redo: their last undo still in force, if it is their last change) */
function findUndo(s: Session, log: Change[], redo: boolean): Change | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const h = log[i];
    if (h.userId !== s.who.userId) continue;
    if (redo) return h.command === "undo" && !h.undoneBy ? h : undefined;
    if (h.undoneBy || h.command === "undo" || h.command === "redo") continue;
    return h;
  }
}

function undoIn(s: Session, log: Change[], found: Change, redo: boolean, company: boolean): Result {
  // its whole group, newest first
  const group = found.group ? log.filter((h) => h.group === found.group && !h.undoneBy && h.command !== "undo").reverse() : [found];
  // nobody changed those things since (where the after is known)
  for (const h of group)
    for (const t of h.targets) {
      if (!(t in h.after)) continue;
      if (!sameSnapshot(snapshot(s, t), h.after[t])) return fail(tr("&1 changed after that (&2): it can't be undone without losing that work.", t, lastChangeOf(log, t, h)));
    }
  const summary = redo ? tr("Redo: ") + found.summary.slice(tr("Undo: ").length) : tr("Undo: ") + found.summary;
  const n = newChange(s.who, redo ? "redo" : "undo", {}, summary);
  n.undoOf = found.id;
  for (const h of group)
    for (const t of h.targets) {
      if (!n.targets.includes(t)) {
        n.targets.push(t);
        n.before[t] = snapshot(s, t);
      }
      restore(s, t, h.before[t]);
    }
  // a redo makes the undone changes count again
  if (redo) for (const h of log) if (h.undoneBy === found.id) h.undoneBy = "";
  for (const h of group) h.undoneBy = n.id;
  for (const t of n.targets) if (t !== "prices") n.after[t] = snapshot(s, t);
  log.push(n);
  if (!company && s.project) s.project.modified = n.when;
  s.changed?.(company ? "company" : "project");
  return ok({ summary: n.summary });
}

/** Who changed a target after change h */
function lastChangeOf(log: Change[], target: string, after: Change): string {
  for (let i = log.length - 1; i >= 0; i--) {
    const h = log[i];
    if (h === after) break;
    if (h.targets.includes(target)) return `${h.who}, ${h.when}`;
  }
  return "?";
}

function changeGet(x: Op, c: Args): Result {
  const id = str(c.id);
  const h = x.p.changes.find((h) => h.id === id) ?? x.co.changes.find((h) => h.id === id);
  if (!h) return fail(tr("There is no change &1.", id));
  return ok({ change: changeToJson(h) });
}

function logList(x: Op, c: Args): Result {
  const out: Result[] = [];
  const limit = "limit" in c ? num(c.limit, "limit") : 50;
  const log = x.p.changes;
  for (let i = log.length - 1; i >= 0 && out.length < limit; i--) {
    const h = log[i];
    if (c.who && !h.who.toLowerCase().includes(str(c.who).toLowerCase())) continue;
    if (c.target && !h.targets.includes(str(c.target))) continue;
    out.push({ id: h.id, when: h.when, who: h.who, via: h.via + (h.model ? " " + h.model : ""), summary: h.summary, undone: h.undoneBy !== "" });
  }
  return ok({ changes: out });
}

// HELPERS

const keys = (c: Args) => Object.keys(c);
const without = (c: Args, ...drop: string[]): Args => Object.fromEntries(Object.entries(c).filter(([k]) => !drop.includes(k)));
const has = (c: Args, k: string) => Object.prototype.hasOwnProperty.call(c, k);
const blank = (v: unknown) => str(v).trim() === "";

function money(f: number): string {
  return f.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// THE COMMANDS

function dispatch(x: Op, command: string, c: Args): Result {
  const extra = x.s.extra?.[command];
  if (extra) return extra(x, c);
  // the company's commands work without a project
  switch (command) {
    case "help":
      return ok({ commands: help() });
    case "undo":
      return undo(x, false);
    case "redo":
      return undo(x, true);
    case "contractor.list":
    case "contractor.get":
    case "contractor.add":
    case "contractor.set":
    case "contractor.delete":
      return contractorCmd(x, command, c);
  }
  if (!x.s.project) return fail(tr("There is no project open."));
  switch (command) {
    case "info":
      return info(x);
    case "log":
      return logList(x, c);
    case "change.get":
      return changeGet(x, c);
    case "project.get":
      return projectGet(x);
    case "project.set":
      return projectSet(x, c);
    case "book.set":
      return bookSet(x, c);
    case "rubro.set":
      return rubroSet(x, c);
    case "rubro.delete":
      return rubroDelete(x, c);
    case "charge.add":
    case "charge.set":
    case "charge.delete":
      return chargeCmd(x, command, c);
    case "resource.list":
      return resourceList(x, c);
    case "resource.get":
      return resourceGet(x, c);
    case "resource.add":
      return resourceAdd(x, c);
    case "resource.set":
      return resourceSet(x, c);
    case "resource.delete":
      return resourceDelete(x, c);
    case "analysis.list":
      return analysisList(x, c);
    case "analysis.get":
      return analysisGet(x, c);
    case "analysis.add":
      return analysisAdd(x, c);
    case "analysis.set":
      return analysisSet(x, c);
    case "analysis.copy":
      return analysisCopy(x, c);
    case "analysis.delete":
      return analysisDelete(x, c);
    case "analysis.addline":
    case "analysis.setline":
    case "analysis.removeline":
      return lineCmd(x, command, c);
    case "analysis.flatten":
      return analysisFlatten(x, c);
    case "budget.list":
      return budgetList(x, c);
    case "item.add":
      return itemAdd(x, c);
    case "item.set":
      return itemSet(x, c);
    case "item.delete":
      return itemDelete(x, c);
    case "item.move":
      return itemMove(x, c);
    case "rubro.coefs":
      return rubroCoefs(x, c);
    case "schedule.get":
      return scheduleGet(x, c);
    case "task.set":
      return taskSet(x, c);
    case "standard.export":
      return standardExport(x, c);
    case "prices.fromstandard":
      return pricesFromStandard(x, c);
    case "contract.list":
    case "contract.get":
    case "contract.add":
    case "contract.set":
    case "contract.delete":
      return contractCmd(x, command, c);
    case "part.add":
    case "part.set":
    case "part.remove":
      return partCmd(x, command, c);
    case "cert.add":
    case "cert.set":
    case "cert.delete":
      return certCmd(x, command, c);
    case "payment.add":
    case "payment.set":
    case "payment.delete":
      return paymentCmd(x, command, c);
  }
  return fail(tr("Unknown command &1.", command));
}

/** What each command takes, for the AI and the help */
export function help(): Record<string, string> {
  return {
    info: "{} -> the project, its counts and who you are",
    log: "{limit?, who?, target?} -> the last changes",
    "change.get": "{id} -> a change of the log (the project's or the company's) with its arguments, and its targets before and after",
    "project.get": "{} -> the Project tab's fields, the end date, the price factor and the choices of the lists",
    undo: "{} -> undoes your last action",
    redo: "{} -> redoes what you undid last",
    "project.set": "{field: value...} the Project tab's fields, as in the file: name, code, workType, use, location, city, province, parcel, plotArea, coveredArea, semiCoveredArea, floors, client, clientTaxId, clientPhone, clientEmail, startDate (yyyy-mm-dd), durationDays, workDaysPerWeek, hoursPerDay, holidays [yyyy-mm-dd...], currency, overheadPct, profitPct, taxesPct, contractMode, advancePct, retentionPct, certificatePeriod, adjustmentIndex, adjustmentBase, guaranteeDays, professionals [{role, name, registration, phone, email}...], notes, designFile",
    "book.set": "{updateCoef?, freightPerKm?} the price book's coefficients",
    "rubro.set": "{number, name}",
    "rubro.delete": "{number, force?}",
    "charge.add": "{name, pct?, amount?, hours?} a labor charge: % of the wage, or an amount over some hours",
    "charge.set": "{index, name?, pct?, amount?, hours?}",
    "charge.delete": "{index}",
    "resource.list": "{kind?, text?, limit?} -> resources with their unit price",
    "resource.get": "{key} -> a resource (key = id or code), its prices and the analyses using it",
    "resource.add": "{kind, name, unit, code?, price?, wage?, machine?, loss?, origin?, distance?, truckLoad?, source?} -> its id and code",
    "resource.set": "{key, field: value...} fields: code, name, unit, kind, price, override, wage, loss, origin, distance, truckLoad, updated, source, machine (null removes it), machine.<power|cost|residualPct|lifeHours|hoursPerYear|interestPct|repairsPct|fuel|fuelPrice|fuelUse|lubricantPct>",
    "resource.delete": "{key, force?} refused while analyses use it, unless force",
    "analysis.list": "{rubro?, text?, limit?} -> analyses with their direct cost and price",
    "analysis.get": "{key} -> an analysis with its lines, parts A/B/C, direct cost, price and problems",
    "analysis.add": "{name, unit, rubro?, code?, laborYield?, equipmentYield?, note?, lines? [{resource|analysis: key, qty}...]} -> its id and code",
    "analysis.set": "{key, field: value...} fields: code, name, unit, rubro, laborYield, equipmentYield, note",
    "analysis.copy": "{key, code?, name?} -> the new id and code",
    "analysis.delete": "{key, force?} refused while other analyses use it, unless force",
    "analysis.addline": "{key, resource|analysis: key, qty}",
    "analysis.setline": "{key, index, qty}",
    "analysis.removeline": "{key, index}",
    "analysis.flatten": "{key} sub-analyses become their resources (the link is lost)",
    "prices.import": "{folder, added?} imports a CSV library (Tincho's licita2003 format)",
    "budget.list": "{rubro?} -> the budget: items (code, description, unit, qty, unit direct cost, unit price, total, problem) and totals by rubro and overall",
    "item.add": "{analysis: key | description + unitCost (a manual item), qty?, rubro? (default: the analysis's), unit?, note?} -> its id and code",
    "item.set": "{key (id or code like 3.02), field: value...} fields: qty, description, unit, unitCost, rubro, analysis, note, coefs [{name, pct}...] (the item's own coefficients), qtySource, designQty, designRef",
    "item.delete": "{key}",
    "item.move": "{key, by} moves an item up (by < 0) or down within its rubro",
    "schedule.get": "{curve?} -> the Gantt: for each item its task (days, crew, after, lag, earlyStart, earlyFinish, slack, critical, start and end dates), the length in working days, the end date, and with curve the money spent each month",
    "task.set": "{key (budget item id or code), days?, crew?, after? [item keys it waits for], lag?, startNotBefore?, done? (0 to 1), suggest? (true: days from the labor hours and the crew)}",
    "contractor.list": "{text?, trade?} -> the company's contractors (shared by all projects), with their documents due",
    "contractor.get": "{key (id or name)}",
    "contractor.add": "{name, trade?, taxId?, contact?, phone?, email?, address?, bank?, note?, docs? [{kind, number, expires (yyyy-mm-dd), file, note}...]} -> its id",
    "contractor.set": "{key, field: value...} the same fields (docs replaces the list)",
    "contractor.delete": "{key} refused while a contract of the open project uses it",
    "standard.export": "{} the project's prices (resources, analyses, rubros, labor charges) go to the company's standard library: new ones added, the same ones (by id) replaced",
    "prices.fromStandard": "{} the project takes the standard library's prices: new resources and analyses added, the same ones replaced",
    "contract.list": "{} -> the project's contracts with their contractor, amount, progress and balance",
    "contract.get": "{key (id or code C-01)} -> a contract: parts (item, qty, % of the item, agreed price, measured), certificates with their amounts [work, adjustment, advance recovered, retention, net] and payments",
    "contract.add": "{contractor (key), title?, code?, mode?, advancePct?, retentionPct?, period?, indexName?, baseIndex?, baseMonth?, signed?, note?} conditions default to the Project tab's -> its id and code",
    "contract.set": "{key, field: value...} the same fields",
    "contract.delete": "{key}",
    "part.add": "{contract, item (budget item key), qty? | pct? (of the item; default: what no contract takes yet), unitPrice? (default: the budget's unit price)}",
    "part.set": "{contract, part (part id or item key), qty? | pct?, unitPrice?}",
    "part.remove": "{contract, part}",
    "cert.add": "{contract, kind? (advance, progress, retention; default progress), period? (yyyy-mm), date?, index?} -> its number",
    "cert.set": "{contract, cert (number), period?, date?, index?, status? (draft, issued), note?, measures? [{part (part id or item key), acc? (accumulated quantity) | pct? (accumulated % of the part)}...]}",
    "cert.delete": "{contract, cert}",
    "payment.add": "{contract, amount, date?, means? (transfer, cheque, cash, other), reference?, certificate? (number), invoice?, invoiceDate?, note?} -> its index",
    "payment.set": "{contract, index, field: value...}",
    "payment.delete": "{contract, index}",
    "design.rows": "{} -> the quantities of the sumi-designer file (Project tab), each row with its key and its analyses (and whether they come from the designer)",
    "design.sync": "{} creates and updates the budget items from the design's quantities and the analyses of each row",
    "design.map": "{key (a row's key), analyses [{code, factor}...]} the analyses of a design row in this project, while sumi-designer has none for it",
    "report.pdf": "{kind (budget, summary, analyses, gantt, certificate), contract? and cert? (for a certificate)} makes a PDF report",
    "rubro.coefs": "{rubro, coefs [{name, pct}...]} the coefficients of a rubro in the budget (on top of the project's)",
  };
}

// INFO AND THE PROJECT

function info(x: Op): Result {
  const p = x.p;
  return ok({
    name: p.name,
    client: p.client,
    location: p.location,
    project: p.id,
    currency: p.currency,
    startDate: p.startDate,
    endDate: endDate(p),
    priceFactor: p.priceFactor,
    updateCoef: p.prices.updateCoef,
    resources: p.prices.resources.size,
    analyses: p.prices.analyses.size,
    rubros: p.prices.rubros.size,
    budgetItems: p.budget.items.length,
    budgetPrice: B.totals(p)[1],
    changes: p.changes.length,
    you: x.s.who.name,
    via: x.s.who.via,
  });
}

function projectGet(x: Op): Result {
  const p = x.p;
  return ok({ project: fieldsToJson(p), id: p.id, endDate: endDate(p), priceFactor: p.priceFactor, created: p.created, modified: p.modified, choices: { workType: WORK_TYPES, use: USAGES, contractMode: CONTRACT_MODES, certificatePeriod: CERTIFICATE_PERIODS } });
}

function projectSet(x: Op, c: Args): Result {
  for (const k of keys(c)) if (!(PROJECT_FIELDS as string[]).includes(k)) return fail(tr("The project has no field &1.", k));
  if (keys(c).length === 0) return fail(tr("Nothing to set."));
  // try it on a copy first: a bad value changes nothing
  const test = { ...x.p, professionals: [], holidays: [] };
  const bad = setFields(test, c);
  if (bad) return fail(tr("The project has no field &1 (or a bad value).", bad));
  x.start("project.set", c, tr("Project: ") + keys(c).join(", "));
  x.touch("project");
  setFields(x.p, c);
  return ok();
}

// THE PRICE BOOK

function bookSet(x: Op, c: Args): Result {
  const b = x.p.prices;
  if (keys(c).length === 0) return fail(tr("Nothing to set."));
  for (const k of keys(c)) if (k !== "updateCoef" && k !== "freightPerKm") return fail(tr("The price book has no field &1.", k));
  const coef = has(c, "updateCoef") ? num(c.updateCoef, "updateCoef") : b.updateCoef;
  const perKm = has(c, "freightPerKm") ? num(c.freightPerKm, "freightPerKm") : b.freightPerKm;
  x.start("book.set", c, tr("Price coefficients: ") + keys(c).join(", "));
  x.touch("book");
  b.updateCoef = coef;
  b.freightPerKm = perKm;
  return ok();
}

function rubroSet(x: Op, c: Args): Result {
  if (!has(c, "number") || blank(c.name)) return fail(tr("rubro.set needs a number and a name."));
  const n = Math.trunc(num(c.number, "number"));
  if (n <= 0) return fail(tr("A rubro number is 1 or more."));
  x.start("rubro.set", c, tr("Rubro &1: &2", n, c.name));
  x.touch("rubros");
  x.p.prices.rubros.set(n, str(c.name));
  return ok();
}

function rubroDelete(x: Op, c: Args): Result {
  const b = x.p.prices;
  const n = Math.trunc(num(c.number, "number"));
  if (!b.rubros.has(n)) return fail(tr("There is no rubro &1.", c.number));
  const used = [...b.analyses.values()].filter((a) => a.rubro === n).length;
  if (used && !c.force) return fail(tr("&1 analyses are in rubro &2.", used, n));
  x.start("rubro.delete", c, tr("Rubro &1 deleted", n));
  x.touch("rubros");
  b.rubros.delete(n);
  return ok();
}

function chargeCmd(x: Op, command: string, c: Args): Result {
  const b = x.p.prices;
  let i = -1;
  if (command !== "charge.add") {
    if (!has(c, "index")) return fail(tr("It needs the index of the charge."));
    i = Math.trunc(num(c.index, "index"));
    if (i < 0 || i >= b.charges.length) return fail(tr("There is no charge &1.", i));
  }
  if (command === "charge.delete") {
    x.start(command, c, tr("Labor charge deleted: &1", b.charges[i].name));
    x.touch("charges");
    b.charges.splice(i, 1);
    return ok();
  }
  const h = command === "charge.add" ? P.newCharge() : { ...b.charges[i] };
  const fields: Args = without(c, "index");
  const next = P.chargeFromJson({ ...P.chargeToJson(h), hours: h.hours, ...fields });
  x.start(command, c, command === "charge.add" ? tr("Labor charge added: &1", c.name) : tr("Labor charge &1 changed", b.charges[i].name));
  x.touch("charges");
  if (command === "charge.add") b.charges.push(next);
  else b.charges[i] = next;
  return ok();
}

// RESOURCES

function findRes(x: Op, c: Args): P.Resource | undefined {
  return c.key ? P.findResource(x.p.prices, str(c.key)) : undefined;
}

export function describeResource(b: P.PriceBook, r: P.Resource): Result {
  const c: Result = P.resourceToJson(r);
  c.unitPrice = P.priceOf(b, r);
  c.basePrice = P.basePrice(b, r);
  if (P.hasCalculation(r)) c.calculated = P.calculatedPrice(b, r);
  const f = P.freight(b, r);
  if (f) c.freight = f;
  return c;
}

function resourceList(x: Op, c: Args): Result {
  const b = x.p.prices;
  const limit = has(c, "limit") ? num(c.limit, "limit") : Infinity;
  const text = str(c.text).toLowerCase();
  const out: Result[] = [];
  for (const r of P.sortedByCode(b.resources.values())) {
    if (c.kind && r.kind !== c.kind) continue;
    if (text && !`${r.code} ${r.name}`.toLowerCase().includes(text)) continue;
    out.push({ id: r.id, code: r.code, name: r.name, unit: r.unit, kind: r.kind, unitPrice: P.priceOf(b, r) });
    if (out.length >= limit) break;
  }
  return ok({ resources: out });
}

function resourceGet(x: Op, c: Args): Result {
  const r = findRes(x, c);
  if (!r) return fail(tr("There is no resource &1.", c.key));
  const out = describeResource(x.p.prices, r);
  out.usedBy = P.usedBy(x.p.prices, r.id, false).map((a) => a.code);
  return ok({ resource: out });
}

function resourceAdd(x: Op, c: Args): Result {
  const b = x.p.prices;
  if (c.kind && !P.KINDS.includes(str(c.kind))) return fail(tr("Unknown kind &1: material, labor or equipment.", c.kind));
  if (blank(c.name)) return fail(tr("A resource needs a name."));
  if (c.code && P.resourceByCode(b, str(c.code))) return fail(tr("There is already a resource &1.", c.code));
  const r = P.newResource();
  if (c.kind) r.kind = str(c.kind);
  const bad = P.applyResource(r, without(c, "id"));
  if (bad) return fail(tr("Resources have no field &1.", bad));
  if (!r.code) r.code = P.nextResourceCode(b, r.kind);
  if (!r.updated && has(c, "price")) r.updated = todayDay();
  x.start("resource.add", c, tr("Resource added: &1 &2", r.code, r.name));
  x.touch("resource:" + r.id);
  b.resources.set(r.id, r);
  return ok({ id: r.id, code: r.code });
}

function resourceSet(x: Op, c: Args): Result {
  const b = x.p.prices;
  const r = findRes(x, c);
  if (!r) return fail(tr("There is no resource &1.", c.key));
  const set = without(c, "key");
  if (keys(set).length === 0) return fail(tr("Nothing to set."));
  if (has(set, "code") && str(set.code) !== r.code && P.resourceByCode(b, str(set.code))) return fail(tr("There is already a resource &1.", set.code));
  if (has(set, "code") && blank(set.code)) return fail(tr("A code can't be empty."));
  // try it on a copy first: a bad field changes nothing
  const bad = P.applyResource(P.resourceFromJson(P.resourceToJson(r)), set);
  if (bad) return fail(tr("Resources have no field &1 (or a bad value).", bad));
  x.start("resource.set", c, tr("Resource &1: &2", r.code, keys(set).join(", ")));
  x.touch("resource:" + r.id);
  P.applyResource(r, set);
  if (has(set, "price") && !has(set, "updated")) r.updated = todayDay();
  return ok();
}

function resourceDelete(x: Op, c: Args): Result {
  const b = x.p.prices;
  const r = findRes(x, c);
  if (!r) return fail(tr("There is no resource &1.", c.key));
  const used = P.usedBy(b, r.id, false);
  if (used.length && !c.force) return fail(tr("&1 analyses use &2 (the first: &3).", used.length, r.code, used[0].code));
  x.start("resource.delete", c, tr("Resource deleted: &1 &2", r.code, r.name));
  x.touch("resource:" + r.id);
  b.resources.delete(r.id);
  return ok();
}

// ANALYSES

function findAna(x: Op, c: Args): P.Analysis | undefined {
  return c.key ? P.findAnalysis(x.p.prices, str(c.key)) : undefined;
}

export function describeAnalysis(p: Project, a: P.Analysis): Result {
  const b = p.prices;
  const c: Result = P.analysisToJson(a);
  const f = P.parts(b, a);
  c.lines = a.lines.map((l, i) => {
    const line: Result = { index: i, qty: l.qty, cost: P.lineCost(b, a, l) };
    if (l.isAnalysis) {
      line.analysis = l.ref;
      const s = b.analyses.get(l.ref);
      if (s) Object.assign(line, { code: s.code, name: s.name, unit: s.unit, unitPrice: P.direct(b, s) });
    } else {
      line.resource = l.ref;
      const r = b.resources.get(l.ref);
      if (r) Object.assign(line, { code: r.code, name: r.name, unit: r.unit, kind: r.kind, unitPrice: P.priceOf(b, r) });
    }
    return line;
  });
  c.materials = f[0];
  c.equipment = f[1];
  c.labor = f[2];
  c.direct = f[0] + f[1] + f[2];
  c.price = (f[0] + f[1] + f[2]) * p.priceFactor;
  c.problems = P.problems(b, a);
  return c;
}

function analysisList(x: Op, c: Args): Result {
  const b = x.p.prices;
  const limit = has(c, "limit") ? num(c.limit, "limit") : Infinity;
  const text = str(c.text).toLowerCase();
  const rubro = c.rubro ? Math.trunc(num(c.rubro, "rubro")) : 0;
  const out: Result[] = [];
  for (const a of P.sortedByCode(b.analyses.values())) {
    if (rubro && a.rubro !== rubro) continue;
    if (text && !`${a.code} ${a.name}`.toLowerCase().includes(text)) continue;
    const d = P.direct(b, a);
    out.push({ id: a.id, code: a.code, name: a.name, unit: a.unit, rubro: a.rubro, direct: d, price: d * x.p.priceFactor });
    if (out.length >= limit) break;
  }
  return ok({ analyses: out });
}

function analysisGet(x: Op, c: Args): Result {
  const a = findAna(x, c);
  if (!a) return fail(tr("There is no analysis &1.", c.key));
  const out = describeAnalysis(x.p, a);
  out.usedBy = P.usedBy(x.p.prices, a.id, true).map((u) => u.code);
  return ok({ analysis: out });
}

/** A line from {resource: key, qty} or {analysis: key, qty}; or why it can't be made */
function makeLine(x: Op, c: Args, forA: P.Analysis | null): P.AnalysisLine | string {
  const b = x.p.prices;
  const qty = has(c, "qty") ? num(c.qty, "qty") : 1;
  if (c.analysis) {
    const a = P.findAnalysis(b, str(c.analysis));
    if (!a) return tr("There is no analysis &1.", c.analysis);
    if (forA && P.contains(b, a, forA.id)) return tr("&1 uses &2: it would be a loop.", a.code, forA.code);
    return { isAnalysis: true, ref: a.id, qty };
  }
  const r = P.findResource(b, str(c.resource));
  if (!r) return tr("There is no resource &1.", c.resource);
  return { isAnalysis: false, ref: r.id, qty };
}

function analysisAdd(x: Op, c: Args): Result {
  const b = x.p.prices;
  if (blank(c.name)) return fail(tr("An analysis needs a name."));
  if (c.code && P.analysisByCode(b, str(c.code))) return fail(tr("There is already an analysis &1.", c.code));
  const a = P.newAnalysis();
  const bad = P.applyAnalysis(a, without(c, "id", "lines"));
  if (bad) return fail(tr("Analyses have no field &1.", bad));
  if (!a.code) a.code = P.nextAnalysisCode(b);
  if (Array.isArray(c.lines))
    for (const v of c.lines) {
      const l = makeLine(x, isObj(v) ? v : {}, a);
      if (typeof l === "string") return fail(l);
      a.lines.push(l);
    }
  x.start("analysis.add", c, tr("Analysis added: &1 &2", a.code, a.name));
  x.touch("analysis:" + a.id);
  b.analyses.set(a.id, a);
  return ok({ id: a.id, code: a.code });
}

function analysisSet(x: Op, c: Args): Result {
  const b = x.p.prices;
  const a = findAna(x, c);
  if (!a) return fail(tr("There is no analysis &1.", c.key));
  const set = without(c, "key");
  if (keys(set).length === 0) return fail(tr("Nothing to set."));
  if (has(set, "lines")) return fail(tr("Lines change with analysis.addline, setline and removeline."));
  if (has(set, "code") && str(set.code) !== a.code && P.analysisByCode(b, str(set.code))) return fail(tr("There is already an analysis &1.", set.code));
  if (has(set, "code") && blank(set.code)) return fail(tr("A code can't be empty."));
  const bad = P.applyAnalysis(P.analysisFromJson(P.analysisToJson(a)), set);
  if (bad) return fail(tr("Analyses have no field &1 (or a bad value).", bad));
  x.start("analysis.set", c, tr("Analysis &1: &2", a.code, keys(set).join(", ")));
  x.touch("analysis:" + a.id);
  P.applyAnalysis(a, set);
  return ok();
}

function analysisCopy(x: Op, c: Args): Result {
  const b = x.p.prices;
  const a = findAna(x, c);
  if (!a) return fail(tr("There is no analysis &1.", c.key));
  const code = c.code ? str(c.code) : P.nextAnalysisCode(b);
  if (P.analysisByCode(b, code)) return fail(tr("There is already an analysis &1.", code));
  const n = P.copyAnalysis(a, code);
  if (c.name) n.name = str(c.name);
  x.start("analysis.copy", c, tr("Analysis &1 copied as &2", a.code, n.code));
  x.touch("analysis:" + n.id);
  b.analyses.set(n.id, n);
  return ok({ id: n.id, code: n.code });
}

function analysisDelete(x: Op, c: Args): Result {
  const b = x.p.prices;
  const a = findAna(x, c);
  if (!a) return fail(tr("There is no analysis &1.", c.key));
  const used = P.usedBy(b, a.id, true);
  if (used.length && !c.force) return fail(tr("&1 analyses use &2 (the first: &3).", used.length, a.code, used[0].code));
  x.start("analysis.delete", c, tr("Analysis deleted: &1 &2", a.code, a.name));
  x.touch("analysis:" + a.id);
  b.analyses.delete(a.id);
  return ok();
}

function lineCmd(x: Op, command: string, c: Args): Result {
  const b = x.p.prices;
  const a = findAna(x, c);
  if (!a) return fail(tr("There is no analysis &1.", c.key));
  let i = 0;
  if (command !== "analysis.addline") {
    if (!has(c, "index")) return fail(tr("It needs the index of the line."));
    i = Math.trunc(num(c.index, "index"));
    if (i < 0 || i >= a.lines.length) return fail(tr("Analysis &1 has no line &2.", a.code, i));
  }
  switch (command) {
    case "analysis.addline": {
      const l = makeLine(x, c, a);
      if (typeof l === "string") return fail(l);
      x.start(command, c, tr("Analysis &1: line added, &2 &3", a.code, l.qty, P.describeRef(b, l)));
      x.touch("analysis:" + a.id);
      a.lines.push(l);
      return ok({ index: a.lines.length - 1 });
    }
    case "analysis.setline": {
      if (!has(c, "qty")) return fail(tr("It needs the quantity (qty)."));
      const q = num(c.qty, "qty");
      x.start(command, c, tr("Analysis &1: &2 now &3", a.code, P.describeRef(b, a.lines[i]), q));
      x.touch("analysis:" + a.id);
      a.lines[i].qty = q;
      break;
    }
    case "analysis.removeline":
      x.start(command, c, tr("Analysis &1: line removed, &2", a.code, P.describeRef(b, a.lines[i])));
      x.touch("analysis:" + a.id);
      a.lines.splice(i, 1);
      break;
  }
  return ok();
}

function analysisFlatten(x: Op, c: Args): Result {
  const a = findAna(x, c);
  if (!a) return fail(tr("There is no analysis &1.", c.key));
  x.start("analysis.flatten", c, tr("Analysis &1 flattened", a.code));
  x.touch("analysis:" + a.id);
  P.flatten(x.p.prices, a);
  return ok();
}

// THE BUDGET

export function describeItem(p: Project, b: B.BudgetItem): Result {
  const c: Result = B.itemToJson(b);
  c.description = B.descriptionOf(p, b);
  c.unit = B.unitOf(p, b);
  const a = b.analysis ? p.prices.analyses.get(b.analysis) : undefined;
  if (a) c.analysisCode = a.code;
  c.unitDirect = B.unitDirect(p, b);
  c.unitPrice = B.itemUnitPrice(p, b);
  c.total = B.itemTotal(p, b);
  const problem = B.itemProblem(p, b);
  if (problem) c.problem = problem;
  return c;
}

function budgetList(x: Op, c: Args): Result {
  const p = x.p;
  const rubro = c.rubro ? Math.trunc(num(c.rubro, "rubro")) : 0;
  const items = p.budget.items.filter((b) => !rubro || b.rubro === rubro).map((b) => describeItem(p, b));
  const rubros = B.usedRubros(p.budget).map((n) => {
    const f = B.totals(p, n);
    return { rubro: n, name: p.prices.rubros.get(n) ?? "", direct: f[0], price: f[1], coefs: B.coefsOf(p.budget, n).map((k) => ({ ...k })) };
  });
  const f = B.totals(p);
  return ok({ items, rubros, direct: f[0], price: f[1], projectFactor: p.priceFactor });
}

function itemAdd(x: Op, c: Args): Result {
  const p = x.p;
  const h = p.budget;
  const b = B.newItem();
  if (c.analysis) {
    const a = P.findAnalysis(p.prices, str(c.analysis));
    if (!a) return fail(tr("There is no analysis &1.", c.analysis));
    b.analysis = a.id;
    b.rubro = a.rubro;
  } else if (blank(c.description)) return fail(tr("An item needs an analysis, or a description (a manual item)."));
  const bad = B.applyItem(b, without(c, "analysis", "id", "key"));
  if (bad) return fail(tr("Budget items have no field &1.", bad));
  x.start("item.add", c, tr("Budget: item added, &1", B.descriptionOf(p, b)));
  x.touch("budget");
  h.items.splice(B.insertPos(h, b.rubro), 0, b);
  B.renumber(h);
  return ok({ id: b.id, code: b.code });
}

function itemSet(x: Op, c: Args): Result {
  const p = x.p;
  const h = p.budget;
  const b = c.key ? B.findItem(h, str(c.key)) : undefined;
  if (!b) return fail(tr("There is no budget item &1.", c.key));
  const set = without(c, "key");
  if (keys(set).length === 0) return fail(tr("Nothing to set."));
  if (set.analysis) {
    const a = P.findAnalysis(p.prices, str(set.analysis));
    if (!a) return fail(tr("There is no analysis &1.", set.analysis));
    set.analysis = a.id;
  }
  const bad = B.applyItem(B.itemFromJson(B.itemToJson(b)), set);
  if (bad) return fail(tr("Budget items have no field &1 (or a bad value).", bad));
  x.start("item.set", c, tr("Budget item &1: &2", b.code, keys(set).join(", ")));
  x.touch("budget");
  B.applyItem(b, set);
  // a new rubro: it goes to the end of that rubro
  if (has(set, "rubro")) {
    h.items.splice(B.indexOfItem(h, b.id), 1);
    h.items.splice(B.insertPos(h, b.rubro), 0, b);
  }
  B.renumber(h);
  return ok({ code: b.code });
}

function itemDelete(x: Op, c: Args): Result {
  const p = x.p;
  const h = p.budget;
  const b = c.key ? B.findItem(h, str(c.key)) : undefined;
  if (!b) return fail(tr("There is no budget item &1.", c.key));
  x.start("item.delete", c, tr("Budget: item deleted, &1 &2", b.code, B.descriptionOf(p, b)));
  x.touch("budget");
  h.items.splice(B.indexOfItem(h, b.id), 1);
  B.renumber(h);
  return ok();
}

function itemMove(x: Op, c: Args): Result {
  const h = x.p.budget;
  const b = c.key ? B.findItem(h, str(c.key)) : undefined;
  if (!b) return fail(tr("There is no budget item &1.", c.key));
  const i = B.indexOfItem(h, b.id);
  const j = i + (num(c.by, "by") < 0 ? -1 : 1);
  if (j < 0 || j >= h.items.length || h.items[j].rubro !== b.rubro) return fail(tr("It is already at the end of its rubro."));
  x.start("item.move", c, tr("Budget: item &1 moved", b.code));
  x.touch("budget");
  h.items.splice(i, 1);
  h.items.splice(j, 0, b);
  B.renumber(h);
  return ok({ code: b.code });
}

function rubroCoefs(x: Op, c: Args): Result {
  const h = x.p.budget;
  const n = Math.trunc(num(c.rubro, "rubro"));
  if (!n) return fail(tr("It needs the rubro number."));
  const list = B.coefsFromJson(c.coefs);
  x.start("rubro.coefs", c, tr("Budget: coefficients of rubro &1", n));
  x.touch("budget");
  if (list.length) h.rubroCoefs.set(n, list);
  else h.rubroCoefs.delete(n);
  return ok();
}

// THE GANTT

function scheduleGet(x: Op, c: Args): Result {
  const p = x.p;
  const s = p.schedule;
  if (S.compute(p)) return fail(s.problem);
  const tasks = p.budget.items.map((b) => {
    const t = s.tasks.get(b.id)!;
    return {
      ...S.taskToJson(t),
      code: b.code,
      description: B.descriptionOf(p, b),
      earlyStart: t.earlyStart,
      earlyFinish: t.earlyFinish,
      slack: S.slack(t),
      critical: S.critical(t),
      start: S.dateOf(p, t.earlyStart),
      end: S.dateOf(p, Math.max(t.earlyStart, t.earlyFinish - 1)),
      laborHoursPerUnit: S.laborHours(p, b),
      done: S.doneOf(p, b),
    };
  });
  const out = ok({ tasks, length: s.length, end: S.dateOf(p, Math.max(0, s.length - 1)), available: p.durationDays });
  if (c.curve) out.curve = S.curve(p);
  return out;
}

function taskSet(x: Op, c: Args): Result {
  const p = x.p;
  const b = c.key ? B.findItem(p.budget, str(c.key)) : undefined;
  if (!b) return fail(tr("There is no budget item &1.", c.key));
  S.sync(p);
  const t = p.schedule.tasks.get(b.id)!;
  const set = without(c, "key", "suggest");
  // "after" by code or id, checked for loops
  if (has(set, "after")) {
    if (!Array.isArray(set.after)) return fail(tr("Tasks have no field &1 (or a bad value).", "after"));
    const after: string[] = [];
    for (const v of set.after) {
      const o = B.findItem(p.budget, str(v));
      if (!o) return fail(tr("There is no budget item &1.", v));
      if (o.id === b.id || S.makesLoop(p.schedule, b.id, o.id)) return fail(tr("&1 can't wait for &2: it would be a loop.", b.code, o.code));
      after.push(o.id);
    }
    set.after = after;
  }
  if (c.suggest) {
    const crew = has(set, "crew") ? num(set.crew, "crew") : t.crew > 0 ? t.crew : 2;
    set.crew = crew;
    set.days = Math.max(1, Math.ceil(S.suggestDays(p, b, crew) - 1e-9));
  }
  if (keys(set).length === 0) return fail(tr("Nothing to set."));
  const bad = S.applyTask({ ...t, after: [...t.after] }, set);
  if (bad) return fail(tr("Tasks have no field &1 (or a bad value).", bad));
  x.start("task.set", c, tr("Gantt: task &1, &2", b.code, keys(set).join(", ")));
  x.touch("schedule");
  S.applyTask(t, set);
  return ok({ days: t.days });
}

// THE COMPANY: CONTRACTORS AND THE STANDARD LIBRARY

function describeContractor(k: Co.Contractor): Result {
  return { ...Co.contractorToJson(k), docsDue: Co.docsDue(k).map((d) => `${d.kind} ${d.expires}`) };
}

function contractorCmd(x: Op, command: string, c: Args): Result {
  const co = x.co;
  if (command === "contractor.list") {
    const trade = str(c.trade).toLowerCase();
    const text = str(c.text).toLowerCase();
    const out = Co.sortedContractors(co)
      .filter((k) => !trade || k.trade.toLowerCase().includes(trade))
      .filter((k) => !text || `${k.name} ${k.trade} ${k.contact}`.toLowerCase().includes(text))
      .map(describeContractor);
    return ok({ contractors: out });
  }
  if (command === "contractor.add") {
    if (blank(c.name)) return fail(tr("A contractor needs a name."));
    if (Co.findContractor(co, str(c.name).trim())) return fail(tr("There is already a contractor &1.", c.name));
    const k = Co.newContractor();
    const bad = Co.applyContractor(k, without(c, "id"));
    if (bad) return fail(tr("Contractors have no field &1.", bad));
    x.start(command, c, tr("Contractor added: &1", k.name));
    x.touch("contractor:" + k.id);
    co.contractors.set(k.id, k);
    return ok({ id: k.id });
  }
  const k = c.key ? Co.findContractor(co, str(c.key)) : undefined;
  if (!k) return fail(tr("There is no contractor &1.", c.key));
  switch (command) {
    case "contractor.get":
      return ok({ contractor: describeContractor(k) });
    case "contractor.set": {
      const set = without(c, "key");
      if (keys(set).length === 0) return fail(tr("Nothing to set."));
      const bad = Co.applyContractor(Co.contractorFromJson(Co.contractorToJson(k)), set);
      if (bad) return fail(tr("Contractors have no field &1 (or a bad value).", bad));
      x.start(command, c, tr("Contractor &1: &2", k.name, keys(set).join(", ")));
      x.touch("contractor:" + k.id);
      Co.applyContractor(k, set);
      break;
    }
    case "contractor.delete": {
      // TODO with several projects on the server: check every project's contracts, not only the open one
      const t = x.s.project?.contracts.find((t) => t.contractor === k.id);
      if (t) return fail(tr("Contract &1 is with &2.", t.code, k.name));
      x.start(command, c, tr("Contractor deleted: &1", k.name));
      x.touch("contractor:" + k.id);
      co.contractors.delete(k.id);
      break;
    }
  }
  return ok();
}

/** Copies what from has into to: resources and analyses by id (replaced or added), rubros, and the labor charges */
function mergeBook(from: P.PriceBook, to: P.PriceBook, charges: boolean): void {
  for (const r of from.resources.values()) to.resources.set(r.id, P.resourceFromJson(P.resourceToJson(r)));
  for (const a of from.analyses.values()) to.analyses.set(a.id, P.analysisFromJson(P.analysisToJson(a)));
  for (const [n, name] of from.rubros) to.rubros.set(n, name);
  if (charges) to.charges = from.charges.map((h) => ({ ...h }));
}

function standardExport(x: Op, c: Args): Result {
  const b = x.p.prices;
  x.start("standard.export", c, tr("Standard library: the prices of &1 exported (&2 resources, &3 analyses)", x.p.name || x.p.id, b.resources.size, b.analyses.size));
  x.touch("standard");
  x.co.standard ??= P.newBook();
  mergeBook(b, x.co.standard, true);
  x.co.standard.updateCoef = 1;
  return ok();
}

function pricesFromStandard(x: Op, c: Args): Result {
  if (!x.co.standard) return fail(tr("The company has no standard library yet (export a project's prices to make it)."));
  x.start("prices.fromStandard", c, tr("Prices taken from the standard library"));
  x.touch("prices");
  mergeBook(x.co.standard, x.p.prices, true);
  return ok();
}

// CONTRACTS

function findContract(x: Op, c: Args, field = "key"): K.Contract | undefined {
  return c[field] ? K.findContract(x.p.contracts, str(c[field])) : undefined;
}

function contractorName(x: Op, id: string): string {
  return Co.findContractor(x.co, id)?.name ?? tr("(unknown contractor)");
}

export function describeContract(x: Op, t: K.Contract): Result {
  const p = x.p;
  const c: Result = K.contractToJson(t);
  const f = K.balance(t);
  Object.assign(c, { contractorName: contractorName(x, t.contractor), amount: K.amount(t), progress: K.progress(t), certified: f[0], paid: f[1], balance: f[2] });
  c.parts = t.parts.map((r) => {
    const part: Result = { ...r };
    const b = B.findItem(p.budget, r.item);
    if (b) {
      Object.assign(part, { code: b.code, description: B.descriptionOf(p, b), unit: B.unitOf(p, b), budgetUnitPrice: B.itemUnitPrice(p, b) });
      if (b.qty) part.pctOfItem = r.qty / b.qty;
    } else part.description = tr("(the budget item is gone)");
    part.measured = K.measured(t, r.id);
    return part;
  });
  c.certificates = (c.certificates as Result[]).map((q, i) => {
    const n = K.numbers(t, t.certificates[i]);
    return { ...q, work: n[0], adjustment: n[1], advanceRecovered: n[2], retention: n[3], net: n[4] };
  });
  return c;
}

function contractCmd(x: Op, command: string, c: Args): Result {
  const p = x.p;
  if (command === "contract.list") {
    return ok({
      contracts: p.contracts.map((t) => {
        const f = K.balance(t);
        return { id: t.id, code: t.code, title: t.title, contractor: contractorName(x, t.contractor), amount: K.amount(t), progress: K.progress(t), certified: f[0], paid: f[1], balance: f[2] };
      }),
    });
  }
  let t: K.Contract | undefined;
  if (command !== "contract.add") {
    t = findContract(x, c);
    if (!t) return fail(tr("There is no contract &1.", c.key));
  }
  const set = without(c, "key", "id");
  let k: Co.Contractor | undefined;
  if (has(set, "contractor")) {
    k = Co.findContractor(x.co, str(set.contractor));
    if (!k) return fail(tr("There is no contractor &1.", set.contractor));
    set.contractor = k.id;
  }
  switch (command) {
    case "contract.get":
      return ok({ contract: describeContract(x, t!) });
    case "contract.add": {
      if (!k) return fail(tr("A contract needs a contractor."));
      if (set.code && K.findContract(p.contracts, str(set.code))) return fail(tr("There is already a contract &1.", set.code));
      const n = K.newContract();
      // the Project tab's conditions
      Object.assign(n, { mode: p.contractMode, advancePct: p.advancePct, retentionPct: p.retentionPct, period: p.certificatePeriod, indexName: p.adjustmentIndex, baseMonth: p.adjustmentBase, signed: todayDay() });
      const bad = K.applyContract(n, set);
      if (bad) return fail(tr("Contracts have no field &1.", bad));
      if (!n.code) n.code = K.nextContractCode(p.contracts);
      if (!n.title) n.title = k.trade;
      x.start(command, c, tr("Contract &1 with &2", n.code, k.name));
      x.touch("contracts");
      p.contracts.push(n);
      return ok({ id: n.id, code: n.code });
    }
    case "contract.set": {
      if (keys(set).length === 0) return fail(tr("Nothing to set."));
      const bad = K.applyContract(K.contractFromJson(K.contractToJson(t!)), set);
      if (bad) return fail(tr("Contracts have no field &1 (or a bad value).", bad));
      x.start(command, c, tr("Contract &1: &2", t!.code, keys(set).join(", ")));
      x.touch("contracts");
      K.applyContract(t!, set);
      break;
    }
    case "contract.delete":
      x.start(command, c, tr("Contract deleted: &1 &2", t!.code, t!.title));
      x.touch("contracts");
      p.contracts.splice(p.contracts.indexOf(t!), 1);
      break;
  }
  return ok();
}

/** The quantity from {qty} or {pct} (of whole); null if neither is given */
function qtyFrom(c: Args, whole: number): number | null {
  if (has(c, "qty")) return num(c.qty, "qty");
  if (has(c, "pct")) return (whole * num(c.pct, "pct")) / 100;
  return null;
}

/** A part of a contract by its id, or by its budget item's id or code */
function findPartBy(x: Op, t: K.Contract, key: unknown): K.ContractPart | undefined {
  if (!key) return undefined;
  const r = K.findPart(t, str(key));
  if (r) return r;
  const b = B.findItem(x.p.budget, str(key));
  return b ? K.findPart(t, b.id) : undefined;
}

function partCmd(x: Op, command: string, c: Args): Result {
  const p = x.p;
  const t = findContract(x, c, "contract");
  if (!t) return fail(tr("There is no contract &1.", c.contract));
  if (command === "part.add") {
    const b = c.item ? B.findItem(p.budget, str(c.item)) : undefined;
    if (!b) return fail(tr("There is no budget item &1.", c.item));
    const f = qtyFrom(c, b.qty) ?? b.qty - K.assigned(p.contracts, b.id);
    if (f <= 0) return fail(tr("Item &1 is already taken by contracts: give the quantity.", b.code));
    const r = K.newPart(b.id, f, has(c, "unitPrice") ? num(c.unitPrice, "unitPrice") : B.itemUnitPrice(p, b));
    x.start(command, c, tr("Contract &1: item &2 added, &3", t.code, b.code, r.qty));
    x.touch("contracts");
    t.parts.push(r);
    return ok({ part: r.id });
  }
  const r = findPartBy(x, t, c.part);
  if (!r) return fail(tr("Contract &1 has no part &2.", t.code, c.part));
  const b = B.findItem(p.budget, r.item);
  if (command === "part.set") {
    const f = qtyFrom(c, b ? b.qty : 0);
    if (f === null && !has(c, "unitPrice")) return fail(tr("Nothing to set."));
    const price = has(c, "unitPrice") ? num(c.unitPrice, "unitPrice") : r.unitPrice;
    x.start(command, c, tr("Contract &1: part changed", t.code));
    x.touch("contracts");
    if (f !== null) r.qty = f;
    r.unitPrice = price;
  } else {
    if (K.measured(t, r.id) > 0) return fail(tr("It has certified work: it can't be removed."));
    x.start(command, c, tr("Contract &1: part removed", t.code));
    x.touch("contracts");
    t.parts.splice(t.parts.indexOf(r), 1);
  }
  return ok();
}

function certCmd(x: Op, command: string, c: Args): Result {
  const t = findContract(x, c, "contract");
  if (!t) return fail(tr("There is no contract &1.", c.contract));
  if (command === "cert.add") {
    const q = K.newCertificate();
    if (c.kind) {
      if (!K.CERT_KINDS.includes(str(c.kind))) return fail(tr("Unknown kind of certificate &1.", c.kind));
      q.kind = str(c.kind);
    }
    let n = 0;
    for (const h of t.certificates) {
      n = Math.max(n, h.number);
      if (q.kind !== K.PROGRESS && h.kind === q.kind) return fail(tr("Contract &1 already has its &2 certificate.", t.code, tr(q.kind)));
    }
    q.number = n + 1;
    q.period = c.period ? str(c.period) : todayDay().slice(0, 7);
    q.date = c.date ? str(c.date) : todayDay();
    if (has(c, "index")) q.index = num(c.index, "index");
    // a progress certificate starts where the last one ended
    if (q.kind === K.PROGRESS)
      for (const r of t.parts) {
        const f = K.measured(t, r.id);
        if (f) q.measures[r.id] = f;
      }
    x.start(command, c, tr("Contract &1: certificate &2 (&3)", t.code, q.number, tr(q.kind)));
    x.touch("contracts");
    t.certificates.push(q);
    return ok({ number: q.number, id: q.id });
  }
  const q = c.cert ? K.findCert(t, str(c.cert)) : undefined;
  if (!q) return fail(tr("Contract &1 has no certificate &2.", t.code, c.cert));
  if (command === "cert.delete") {
    if (q !== t.certificates[t.certificates.length - 1]) return fail(tr("Only the last certificate can be deleted."));
    x.start(command, c, tr("Contract &1: certificate &2 deleted", t.code, q.number));
    x.touch("contracts");
    t.certificates.pop();
    return ok();
  }
  // cert.set: check everything first
  if (q.status === "issued" && has(c, "measures")) return fail(tr("Certificate &1 is issued: its measures can't change (set it back to draft first).", q.number));
  const measures: Record<string, number> = {};
  if (has(c, "measures")) {
    if (!Array.isArray(c.measures)) return fail(tr("A measure needs acc (the accumulated quantity) or pct."));
    for (const v of c.measures) {
      const m = isObj(v) ? v : {};
      const r = findPartBy(x, t, m.part);
      if (!r) return fail(tr("Contract &1 has no part &2.", t.code, m.part));
      let f: number;
      if (has(m, "acc")) f = num(m.acc, "acc");
      else if (has(m, "pct")) f = (r.qty * num(m.pct, "pct")) / 100;
      else return fail(tr("A measure needs acc (the accumulated quantity) or pct."));
      const before = K.measuredBefore(t, q, r.id);
      if (f < before - 1e-9) return fail(tr("The accumulated quantity can't go back (&1 before).", before));
      if (f > r.qty * 1.0000001) return fail(tr("&1 is more than the contract's &2.", f, r.qty));
      measures[r.id] = f;
    }
  }
  if (c.status && c.status !== "draft" && c.status !== "issued") return fail(tr("The status is draft or issued."));
  const index = has(c, "index") ? num(c.index, "index") : q.index;
  x.start(command, c, tr("Contract &1: certificate &2 changed", t.code, q.number));
  x.touch("contracts");
  Object.assign(q.measures, measures);
  if (has(c, "period")) q.period = str(c.period);
  if (has(c, "date")) q.date = str(c.date);
  q.index = index;
  if (c.status) q.status = str(c.status);
  if (has(c, "note")) q.note = str(c.note);
  return ok({ net: K.numbers(t, q)[4] });
}

function paymentCmd(x: Op, command: string, c: Args): Result {
  const t = findContract(x, c, "contract");
  if (!t) return fail(tr("There is no contract &1.", c.contract));
  const set = without(c, "contract", "index");
  if (set.certificate) {
    const q = K.findCert(t, str(set.certificate));
    if (!q) return fail(tr("Contract &1 has no certificate &2.", t.code, set.certificate));
    set.certificate = q.id;
  }
  if (command === "payment.add") {
    if (!has(c, "amount")) return fail(tr("A payment needs its amount."));
    const y = K.newPayment();
    y.date = todayDay();
    const bad = K.applyPayment(y, set);
    if (bad) return fail(tr("Payments have no field &1.", bad));
    x.start(command, c, tr("Contract &1: payment of &2", t.code, money(y.amount)));
    x.touch("contracts");
    t.payments.push(y);
    return ok({ index: t.payments.length - 1 });
  }
  const i = Math.trunc(num(c.index, "index"));
  if (i < 0 || i >= t.payments.length) return fail(tr("Contract &1 has no payment &2.", t.code, i));
  if (command === "payment.delete") {
    x.start(command, c, tr("Contract &1: payment deleted", t.code));
    x.touch("contracts");
    t.payments.splice(i, 1);
    return ok();
  }
  const bad = K.applyPayment({ ...t.payments[i] }, set);
  if (bad) return fail(tr("Payments have no field &1 (or a bad value).", bad));
  x.start(command, c, tr("Contract &1: payment changed", t.code));
  x.touch("contracts");
  K.applyPayment(t.payments[i], set);
  return ok();
}
