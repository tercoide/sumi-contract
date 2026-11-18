// A project's prices: its resources, unit price analyses and rubros, and the labor charges (port of PriceBook,
// Resource, Machine, LaborCharge, Analysis and AnalysisLine). The JSON is the Gambas file's, field by field.
//
// The cost of an analysis (parts): its resources' unit prices times their quantities, split by kind:
//   A materials, B equipment / equipmentYield, C labor / laborYield; a sub-analysis adds its own A, B and C
//   times its quantity. D = A + B + C is the direct cost.
// A unit price = (base price + freight) × (1 + loss %) × updateCoef, where the base price is the calculation
// (labor: wage + charges; equipment: its machine) unless override, else the typed price;
// freight = freightPerKm × distance / truckLoad. updateCoef is licita2003's "coeficiente interno".
// A missing resource or analysis costs 0 and is listed by problems: never silently.

import { makeId } from "./ids.ts";
import { BadValue, bool, int, isObj, num, str, tr } from "./text.ts";

export const MATERIAL = "material";
export const LABOR = "labor";
export const EQUIPMENT = "equipment";
export const KINDS = [MATERIAL, LABOR, EQUIPMENT];

export const MAX_DEPTH = 16; // sub-analyses nested deeper are taken as a loop

// THE MACHINE: the hourly cost of a piece of equipment, as licita2003's "equ" sheet

export interface Machine {
  power: number; // HP
  cost: number; // purchase cost today
  residualPct: number; // value left at the end of its life, % of cost
  lifeHours: number;
  hoursPerYear: number;
  interestPct: number; // yearly rate over half the cost (the average capital)
  repairsPct: number; // repairs and spare parts, % of the depreciation
  fuel: string;
  fuelPrice: number; // $ a liter
  fuelUse: number; // liters per HP and hour
  lubricantPct: number; // % of the fuel cost
}

export const MACHINE_FIELDS = ["power", "cost", "residualPct", "lifeHours", "hoursPerYear", "interestPct", "repairsPct", "fuel", "fuelPrice", "fuelUse", "lubricantPct"] as const;

export function newMachine(): Machine {
  return { power: 0, cost: 0, residualPct: 10, lifeHours: 10000, hoursPerYear: 2000, interestPct: 7, repairsPct: 75, fuel: "Gas Oil", fuelPrice: 0, fuelUse: 0.19, lubricantPct: 30 };
}

/** Sets a field by its file name; false if there is no such field */
export function setMachineField(m: Machine, field: string, v: unknown): boolean {
  if (!(MACHINE_FIELDS as readonly string[]).includes(field)) return false;
  if (field === "fuel") m.fuel = str(v);
  else (m as unknown as Record<string, number>)[field] = num(v, "machine." + field);
  return true;
}

export function machineFromJson(c: unknown): Machine {
  const m = newMachine();
  if (isObj(c)) for (const [k, v] of Object.entries(c)) setMachineField(m, k, v);
  return m;
}

export const machine = {
  depreciation: (m: Machine) => (m.lifeHours <= 0 ? 0 : (m.cost * (1 - m.residualPct / 100)) / m.lifeHours),
  interest: (m: Machine) => (m.hoursPerYear <= 0 ? 0 : (m.cost * 0.5 * m.interestPct) / 100 / m.hoursPerYear),
  repairs: (m: Machine) => (machine.depreciation(m) * m.repairsPct) / 100,
  fuelCost: (m: Machine) => m.power * m.fuelUse * m.fuelPrice,
  lubricants: (m: Machine) => (machine.fuelCost(m) * m.lubricantPct) / 100,
  perHour: (m: Machine) => machine.depreciation(m) + machine.interest(m) + machine.repairs(m) + machine.fuelCost(m) + machine.lubricants(m),
};

// THE LABOR CHARGES: what an hour of labor costs besides the wage, a % of it or an amount over some hours

export interface LaborCharge {
  name: string;
  pct: number;
  amount: number;
  hours: number;
}

export function newCharge(name = "", pct = 0, amount = 0, hours = 176): LaborCharge {
  return { name, pct, amount, hours };
}

export function chargePerHour(c: LaborCharge, wage: number): number {
  let f = (wage * c.pct) / 100;
  if (c.amount && c.hours > 0) f += c.amount / c.hours;
  return f;
}

export function chargeToJson(c: LaborCharge): Record<string, unknown> {
  const o: Record<string, unknown> = { name: c.name };
  if (c.pct) o.pct = c.pct;
  if (c.amount) {
    o.amount = c.amount;
    o.hours = c.hours;
  }
  return o;
}

export function chargeFromJson(c: unknown): LaborCharge {
  const h = newCharge();
  if (!isObj(c)) return h;
  if ("name" in c) h.name = str(c.name);
  if ("pct" in c) h.pct = num(c.pct, "pct");
  if ("amount" in c) h.amount = num(c.amount, "amount");
  if ("hours" in c) h.hours = num(c.hours, "hours");
  return h;
}

/** The labor charges of licita2003 (its "mdo" sheet), for a new book */
export function defaultCharges(): LaborCharge[] {
  return [
    newCharge(tr("Presentismo"), 20),
    newCharge(tr("Law 19032"), 3),
    newCharge(tr("Health insurance"), 3),
    newCharge(tr("Union"), 2.5),
    newCharge(tr("ISSPIC"), 0.5),
    newCharge(tr("Retirement"), 7),
    newCharge(tr("Others"), 3),
    newCharge(tr("Vacations"), 4.2),
    newCharge(tr("Decree (monthly)"), 0, 200, 176),
    newCharge(tr("Work clothes (semester)"), 0, 60, 1056),
  ];
}

// RESOURCES

export interface Resource {
  id: string;
  code: string;
  name: string;
  unit: string;
  kind: string; // MATERIAL, LABOR or EQUIPMENT
  price: number; // typed unit price
  override: boolean; // labor / equipment: use price, not the calculation
  wage: number; // labor: $ an hour before charges (0 = no calculation)
  machine: Machine | null; // equipment: its hourly cost calculation
  loss: number; // waste %: the price is raised by this
  origin: string; // where it is bought
  distance: number; // km to the work (freight)
  truckLoad: number; // units a truck carries (0 = no freight)
  updated: string; // when the price was last set (yyyy-mm-dd)
  source: string; // where the price came from
}

export function newResource(): Resource {
  return { id: makeId("r"), code: "", name: "", unit: "", kind: MATERIAL, price: 0, override: false, wage: 0, machine: null, loss: 0, origin: "", distance: 0, truckLoad: 0, updated: "", source: "" };
}

/** The code prefix of new resources of a kind */
export function codePrefix(kind: string): string {
  return kind === LABOR ? "MO" : kind === EQUIPMENT ? "EQ" : "MAT";
}

export function hasCalculation(r: Resource): boolean {
  if (r.kind === LABOR) return r.wage > 0;
  if (r.kind === EQUIPMENT) return r.machine !== null;
  return false;
}

export function resourceToJson(r: Resource): Record<string, unknown> {
  const c: Record<string, unknown> = { id: r.id, code: r.code, name: r.name, unit: r.unit, kind: r.kind, price: r.price };
  if (r.override) c.override = true;
  if (r.wage) c.wage = r.wage;
  if (r.machine) c.machine = { ...r.machine };
  if (r.loss) c.loss = r.loss;
  if (r.origin) c.origin = r.origin;
  if (r.distance) c.distance = r.distance;
  if (r.truckLoad) c.truckLoad = r.truckLoad;
  if (r.updated) c.updated = r.updated;
  if (r.source) c.source = r.source;
  return c;
}

export function resourceFromJson(c: unknown): Resource {
  const r = newResource();
  if (!isObj(c)) return r;
  if (c.id) r.id = str(c.id);
  applyResource(r, c);
  return r;
}

/** Sets the fields present in c (the file's names; "machine": null removes the calculation, "machine.<field>"
 *  sets one of its fields). Returns the name of a field it doesn't know or can't take, or "". */
export function applyResource(r: Resource, c: Record<string, unknown>): string {
  for (const [key, v] of Object.entries(c)) {
    try {
      switch (key) {
        case "id":
          break;
        case "code":
          r.code = str(v);
          break;
        case "name":
          r.name = str(v);
          break;
        case "unit":
          r.unit = str(v);
          break;
        case "kind":
          if (!KINDS.includes(str(v))) return "kind";
          r.kind = str(v);
          break;
        case "price":
          r.price = num(v, key);
          break;
        case "override":
          r.override = bool(v);
          break;
        case "wage":
          r.wage = num(v, key);
          break;
        case "machine":
          r.machine = v === null || v === undefined ? null : machineFromJson(v);
          break;
        case "loss":
          r.loss = num(v, key);
          break;
        case "origin":
          r.origin = str(v);
          break;
        case "distance":
          r.distance = num(v, key);
          break;
        case "truckLoad":
          r.truckLoad = num(v, key);
          break;
        case "updated":
          r.updated = str(v);
          break;
        case "source":
          r.source = str(v);
          break;
        default:
          if (key.startsWith("machine.")) {
            r.machine ??= newMachine();
            if (!setMachineField(r.machine, key.slice(8), v)) return key;
          } else return key;
      }
    } catch (e) {
      if (e instanceof BadValue) return key;
      throw e;
    }
  }
  return "";
}

// ANALYSES

export interface AnalysisLine {
  isAnalysis: boolean;
  ref: string; // the id of the resource or analysis
  qty: number;
}

export interface Analysis {
  id: string;
  code: string;
  rubro: number;
  name: string;
  unit: string;
  laborYield: number;
  equipmentYield: number;
  lines: AnalysisLine[];
  note: string;
}

export function newAnalysis(): Analysis {
  return { id: makeId("a"), code: "", rubro: 0, name: "", unit: "", laborYield: 1, equipmentYield: 1, lines: [], note: "" };
}

export function lineToJson(l: AnalysisLine): Record<string, unknown> {
  return l.isAnalysis ? { analysis: l.ref, qty: l.qty } : { resource: l.ref, qty: l.qty };
}

export function lineFromJson(c: unknown): AnalysisLine {
  if (!isObj(c)) return { isAnalysis: false, ref: "", qty: 0 };
  if ("analysis" in c) return { isAnalysis: true, ref: str(c.analysis), qty: num(c.qty, "qty") };
  return { isAnalysis: false, ref: str(c.resource), qty: num(c.qty, "qty") };
}

export function analysisToJson(a: Analysis): Record<string, unknown> {
  const c: Record<string, unknown> = { id: a.id, code: a.code, rubro: a.rubro, name: a.name, unit: a.unit };
  if (a.laborYield !== 1) c.laborYield = a.laborYield;
  if (a.equipmentYield !== 1) c.equipmentYield = a.equipmentYield;
  c.lines = a.lines.map(lineToJson);
  if (a.note) c.note = a.note;
  return c;
}

export function analysisFromJson(c: unknown): Analysis {
  const a = newAnalysis();
  if (!isObj(c)) return a;
  if (c.id) a.id = str(c.id);
  applyAnalysis(a, c);
  if (Array.isArray(c.lines)) a.lines = c.lines.map(lineFromJson);
  return a;
}

/** Sets the fields present in c (the file's names, not the lines). Returns a field it doesn't know, or "". */
export function applyAnalysis(a: Analysis, c: Record<string, unknown>): string {
  for (const [key, v] of Object.entries(c)) {
    try {
      switch (key) {
        case "id":
        case "lines":
          break;
        case "code":
          a.code = str(v);
          break;
        case "rubro":
          a.rubro = int(v, key);
          break;
        case "name":
          a.name = str(v);
          break;
        case "unit":
          a.unit = str(v);
          break;
        case "laborYield":
          a.laborYield = num(v, key);
          break;
        case "equipmentYield":
          a.equipmentYield = num(v, key);
          break;
        case "note":
          a.note = str(v);
          break;
        default:
          return key;
      }
    } catch (e) {
      if (e instanceof BadValue) return key;
      throw e;
    }
  }
  return "";
}

/** A copy with a new id and another code */
export function copyAnalysis(a: Analysis, code: string): Analysis {
  return { ...a, id: makeId("a"), code, lines: a.lines.map((l) => ({ ...l })) };
}

// THE BOOK

export interface PriceBook {
  resources: Map<string, Resource>; // by id, in the order they came
  analyses: Map<string, Analysis>;
  rubros: Map<number, string>; // name by number
  charges: LaborCharge[];
  updateCoef: number; // every unit price is multiplied by it
  freightPerKm: number; // $ a km for a truck (licita2003's Notas: own truck)
  source: string; // where the prices came from (the imported library)
}

export function newBook(): PriceBook {
  return { resources: new Map(), analyses: new Map(), rubros: new Map(), charges: defaultCharges(), updateCoef: 1, freightPerKm: 0.85, source: "" };
}

export function rubrosToJson(b: PriceBook): Record<string, unknown>[] {
  return [...b.rubros].map(([number, name]) => ({ number, name }));
}

export function rubrosFromJson(b: PriceBook, v: unknown): void {
  b.rubros.clear();
  if (Array.isArray(v)) for (const w of v) if (isObj(w) && w.name) b.rubros.set(int(w.number, "number"), str(w.name));
}

export function bookToJson(b: PriceBook): Record<string, unknown> {
  return {
    updateCoef: b.updateCoef,
    freightPerKm: b.freightPerKm,
    source: b.source,
    resources: [...b.resources.values()].map(resourceToJson),
    analyses: [...b.analyses.values()].map(analysisToJson),
    rubros: rubrosToJson(b),
    charges: b.charges.map(chargeToJson),
  };
}

/** From what bookToJson wrote, onto b (what is in c is added or replaced; what is missing is kept) */
export function bookFromJson(b: PriceBook, c: unknown): PriceBook {
  if (!isObj(c)) return b;
  if ("updateCoef" in c) b.updateCoef = num(c.updateCoef, "updateCoef");
  if ("freightPerKm" in c) b.freightPerKm = num(c.freightPerKm, "freightPerKm");
  if ("source" in c) b.source = str(c.source);
  if (Array.isArray(c.resources))
    for (const v of c.resources) {
      const r = resourceFromJson(v);
      b.resources.set(r.id, r);
    }
  if (Array.isArray(c.analyses))
    for (const v of c.analyses) {
      const a = analysisFromJson(v);
      b.analyses.set(a.id, a);
    }
  if (Array.isArray(c.rubros)) for (const w of c.rubros) if (isObj(w) && w.name) b.rubros.set(int(w.number, "number"), str(w.name));
  if (Array.isArray(c.charges)) b.charges = c.charges.map(chargeFromJson);
  return b;
}

// THE COST

/** $ an hour for a wage: the wage plus every charge */
export function laborCost(b: PriceBook, wage: number): number {
  let f = wage;
  for (const c of b.charges) f += chargePerHour(c, wage);
  return f;
}

/** The total of the percentage charges (for showing) */
export function chargesPct(b: PriceBook): number {
  return b.charges.reduce((f, c) => f + c.pct, 0);
}

/** The calculated price, whatever override says (0 if there is no calculation) */
export function calculatedPrice(b: PriceBook, r: Resource): number {
  if (r.kind === LABOR && r.wage > 0) return laborCost(b, r.wage);
  if (r.kind === EQUIPMENT && r.machine) return machine.perHour(r.machine);
  return 0;
}

/** The price before freight, losses and the update coefficient: calculated, or typed */
export function basePrice(b: PriceBook, r: Resource): number {
  if (!r.override && hasCalculation(r)) return calculatedPrice(b, r);
  return r.price;
}

export function freight(b: PriceBook, r: Resource): number {
  if (r.truckLoad <= 0 || r.distance <= 0) return 0;
  return (b.freightPerKm * r.distance) / r.truckLoad;
}

export function priceOf(b: PriceBook, r: Resource): number {
  return (basePrice(b, r) + freight(b, r)) * (1 + r.loss / 100) * b.updateCoef;
}

export function unitPrice(b: PriceBook, id: string): number {
  const r = b.resources.get(id);
  return r ? priceOf(b, r) : 0;
}

/** [A materials, B equipment, C labor] of one unit of analysis a, yields applied */
export function parts(b: PriceBook, a: Analysis, depth = 0): [number, number, number] {
  let mat = 0;
  let eq = 0;
  let lab = 0;
  const eqYield = a.equipmentYield > 0 ? a.equipmentYield : 1;
  const labYield = a.laborYield > 0 ? a.laborYield : 1;
  if (depth > MAX_DEPTH) return [0, 0, 0];
  for (const l of a.lines) {
    if (l.isAnalysis) {
      const s = b.analyses.get(l.ref);
      if (!s) continue;
      const p = parts(b, s, depth + 1);
      mat += l.qty * p[0];
      eq += l.qty * p[1];
      lab += l.qty * p[2];
    } else {
      const r = b.resources.get(l.ref);
      if (!r) continue;
      if (r.kind === LABOR) lab += (l.qty * priceOf(b, r)) / labYield;
      else if (r.kind === EQUIPMENT) eq += (l.qty * priceOf(b, r)) / eqYield;
      else mat += l.qty * priceOf(b, r);
    }
  }
  return [mat, eq, lab];
}

/** The direct cost of one unit (D = A + B + C) */
export function direct(b: PriceBook, a: Analysis): number {
  const p = parts(b, a);
  return p[0] + p[1] + p[2];
}

/** What a line costs in its analysis (for showing it): quantity × unit price, the yield applied */
export function lineCost(b: PriceBook, a: Analysis, l: AnalysisLine): number {
  if (l.isAnalysis) {
    const s = b.analyses.get(l.ref);
    return s ? l.qty * direct(b, s) : 0;
  }
  const r = b.resources.get(l.ref);
  if (!r) return 0;
  if (r.kind === LABOR) return (l.qty * priceOf(b, r)) / (a.laborYield > 0 ? a.laborYield : 1);
  if (r.kind === EQUIPMENT) return (l.qty * priceOf(b, r)) / (a.equipmentYield > 0 ? a.equipmentYield : 1);
  return l.qty * priceOf(b, r);
}

/** What is wrong with an analysis: missing resources or sub-analyses, zero prices, loops. Empty if nothing. */
export function problems(b: PriceBook, a: Analysis): string[] {
  const out: string[] = [];
  for (const l of a.lines) {
    if (l.isAnalysis) {
      const s = b.analyses.get(l.ref);
      if (!s) out.push(tr("Analysis &1 does not exist", l.ref));
      else if (contains(b, s, a.id)) out.push(tr("Analysis &1 includes this one: a loop", s.code));
    } else {
      const r = b.resources.get(l.ref);
      if (!r) out.push(tr("Resource &1 does not exist", l.ref));
      else if (priceOf(b, r) === 0) out.push(tr("Resource &1 has no price", r.code));
    }
    if (l.qty === 0) out.push(tr("A line has no quantity (&1)", describeRef(b, l)));
  }
  if (a.lines.length === 0) out.push(tr("It has no lines"));
  return out;
}

/** Does a use analysis id, directly or inside its sub-analyses? (a itself counts) */
export function contains(b: PriceBook, a: Analysis, id: string, depth = 0): boolean {
  if (a.id === id) return true;
  if (depth > MAX_DEPTH) return true;
  for (const l of a.lines) {
    if (!l.isAnalysis) continue;
    const s = b.analyses.get(l.ref);
    if (s && contains(b, s, id, depth + 1)) return true;
  }
  return false;
}

/** Replaces sub-analysis lines by their resources times the quantity, merging repeated ones (licita2003's
 *  "Insertar análisis": the link is lost, and so are the sub-analyses' yields) */
export function flatten(b: PriceBook, a: Analysis): void {
  const qty = new Map<string, number>();
  const collect = (x: Analysis, factor: number, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const l of x.lines) {
      if (l.isAnalysis) {
        const s = b.analyses.get(l.ref);
        if (s) collect(s, factor * l.qty, depth + 1);
      } else qty.set(l.ref, (qty.get(l.ref) ?? 0) + factor * l.qty);
    }
  };
  collect(a, 1, 0);
  a.lines = [...qty].map(([ref, q]) => ({ isAnalysis: false, ref, qty: q }));
}

// LOOKUPS

export function resourceByCode(b: PriceBook, code: string): Resource | undefined {
  for (const r of b.resources.values()) if (r.code === code) return r;
}

export function analysisByCode(b: PriceBook, code: string): Analysis | undefined {
  for (const a of b.analyses.values()) if (a.code === code) return a;
}

/** A resource or analysis by id or by code (what the AI and the screens give) */
export function findResource(b: PriceBook, key: string): Resource | undefined {
  return b.resources.get(key) ?? resourceByCode(b, key);
}

export function findAnalysis(b: PriceBook, key: string): Analysis | undefined {
  return b.analyses.get(key) ?? analysisByCode(b, key);
}

/** "code name" of what a line points to */
export function describeRef(b: PriceBook, l: AnalysisLine): string {
  const x = l.isAnalysis ? b.analyses.get(l.ref) : b.resources.get(l.ref);
  return x ? `${x.code} ${x.name}` : l.ref;
}

/** Codes that are numbers sort by value ("9" before "10"), before codes with letters */
export function sortKey(code: string): string {
  if (/^\d{1,12}$/.test(code)) return "0" + code.padStart(12, "0");
  return "1" + code.toLowerCase();
}

/** Things with a code and an id, sorted by code */
export function sortedByCode<T extends { code: string; id: string }>(items: Iterable<T>): T[] {
  return [...items]
    .map((o) => ({ k: sortKey(o.code) + "\u0001" + o.id, o }))
    .sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0))
    .map((x) => x.o);
}

/** The analyses that use resource or analysis id in a line */
export function usedBy(b: PriceBook, id: string, isAnalysis: boolean): Analysis[] {
  return [...b.analyses.values()].filter((a) => a.lines.some((l) => l.isAnalysis === isAnalysis && l.ref === id));
}

/** A free code for a new resource of a kind: "MAT-0001", "MO-0001", "EQ-0001"... */
export function nextResourceCode(b: PriceBook, kind: string): string {
  return nextCode(codePrefix(kind) + "-", [...b.resources.values()].map((r) => r.code));
}

export function nextAnalysisCode(b: PriceBook): string {
  return nextCode("AN-", [...b.analyses.values()].map((a) => a.code));
}

function nextCode(prefix: string, codes: string[]): string {
  let i = 0;
  for (const c of codes) {
    if (!c.startsWith(prefix)) continue;
    const n = Number(c.slice(prefix.length));
    if (Number.isInteger(n)) i = Math.max(i, n);
  }
  return prefix + String(i + 1).padStart(4, "0");
}
