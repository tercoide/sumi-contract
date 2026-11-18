// The budget: items grouped by rubro, each an analysis × a quantity (or a manual item), priced with the
// project's price book and coefficients at three levels: the project's chain (priceFactor), the rubro's
// (rubroCoefs) and the item's. Quantities come from sumi-designer or are typed here. (Port of Budget,
// BudgetItem and Coef; the JSON is the Gambas file's.)

import { makeId } from "./ids.ts";
import { direct, type PriceBook } from "./prices.ts";
import { BadValue, int, isObj, num, str, tr } from "./text.ts";

// COEFFICIENTS: a % with its reason ("financial cost", "access difficulty", "IIBB"...)

export interface Coef {
  name: string;
  pct: number;
}

export function coefsFromJson(v: unknown): Coef[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((w) => ({ name: str(w.name), pct: num(w.pct, "pct") }));
}

/** The product of the factors of a list */
export function chain(coefs: Coef[]): number {
  return coefs.reduce((f, k) => f * (1 + k.pct / 100), 1);
}

// ITEMS

export interface BudgetItem {
  id: string;
  code: string; // "3.02": rubro and order
  rubro: number;
  analysis: string; // the analysis id ("" = a manual item)
  description: string; // "" = the analysis's name
  unit: string; // "" = the analysis's unit
  qty: number;
  qtySource: string; // "manual" or "design"
  designQty: number; // what the design said, when qtySource = "design"
  designRef: string; // what of the design it measures
  unitCost: number; // a manual item's direct cost a unit
  coefs: Coef[]; // its own coefficients
  note: string;
}

export function newItem(): BudgetItem {
  return { id: makeId("i"), code: "", rubro: 0, analysis: "", description: "", unit: "", qty: 0, qtySource: "manual", designQty: 0, designRef: "", unitCost: 0, coefs: [], note: "" };
}

/** The quantity was changed by hand after coming from the design */
export function overridden(b: BudgetItem): boolean {
  return b.qtySource === "design" && Math.abs(b.qty - b.designQty) > 1e-9;
}

export function itemToJson(b: BudgetItem): Record<string, unknown> {
  const c: Record<string, unknown> = { id: b.id, code: b.code, rubro: b.rubro };
  if (b.analysis) c.analysis = b.analysis;
  if (b.description) c.description = b.description;
  if (b.unit) c.unit = b.unit;
  c.qty = b.qty;
  c.qtySource = b.qtySource;
  if (b.qtySource === "design") c.designQty = b.designQty;
  if (b.designRef) c.designRef = b.designRef;
  if (b.unitCost) c.unitCost = b.unitCost;
  if (b.coefs.length) c.coefs = b.coefs.map((k) => ({ name: k.name, pct: k.pct }));
  if (b.note) c.note = b.note;
  return c;
}

export function itemFromJson(c: unknown): BudgetItem {
  const b = newItem();
  if (!isObj(c)) return b;
  if (c.id) b.id = str(c.id);
  applyItem(b, c);
  return b;
}

/** Sets the fields present in c (the file's names). Returns a field it doesn't know or can't take, or "". */
export function applyItem(b: BudgetItem, c: Record<string, unknown>): string {
  for (const [key, v] of Object.entries(c)) {
    try {
      switch (key) {
        case "id":
          break;
        case "code":
          b.code = str(v);
          break;
        case "rubro":
          b.rubro = int(v, key);
          break;
        case "analysis":
          b.analysis = str(v);
          break;
        case "description":
          b.description = str(v);
          break;
        case "unit":
          b.unit = str(v);
          break;
        case "qty":
          b.qty = num(v, key);
          break;
        case "qtySource":
          if (v !== "manual" && v !== "design") return key;
          b.qtySource = v;
          break;
        case "designQty":
          b.designQty = num(v, key);
          break;
        case "designRef":
          b.designRef = str(v);
          break;
        case "unitCost":
          b.unitCost = num(v, key);
          break;
        case "coefs":
          if (v !== null && v !== undefined && !Array.isArray(v)) return key;
          b.coefs = coefsFromJson(v);
          break;
        case "note":
          b.note = str(v);
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

// THE BUDGET

export interface Budget {
  items: BudgetItem[]; // in order: by rubro, then as people arranged them
  rubroCoefs: Map<number, Coef[]>;
  designMap: Record<string, unknown>; // the analyses of a design row ([{code, factor}...] by row key) while
  // sumi-designer has none for it: the designer's map wins (see design.ts)
}

export function newBudget(): Budget {
  return { items: [], rubroCoefs: new Map(), designMap: {} };
}

export function budgetToJson(h: Budget): Record<string, unknown> {
  const rubroCoefs: Record<string, unknown> = {};
  for (const [n, list] of h.rubroCoefs) rubroCoefs[String(n)] = list.map((k) => ({ name: k.name, pct: k.pct }));
  return { items: h.items.map(itemToJson), rubroCoefs, designMap: structuredClone(h.designMap) };
}

export function budgetFromJson(c: unknown): Budget {
  const h = newBudget();
  if (!isObj(c)) return h;
  if (isObj(c.designMap)) h.designMap = structuredClone(c.designMap);
  if (Array.isArray(c.items)) h.items = c.items.map(itemFromJson);
  if (isObj(c.rubroCoefs)) for (const [k, v] of Object.entries(c.rubroCoefs)) h.rubroCoefs.set(Number(k), coefsFromJson(v));
  return h;
}

/** What the budget's numbers need from the project */
export interface Pricing {
  prices: PriceBook;
  budget: Budget;
  priceFactor: number; // the project's coefficients
}

/** The direct cost of one unit of an item */
export function unitDirect(p: Pricing, b: BudgetItem): number {
  if (b.analysis) {
    const a = p.prices.analyses.get(b.analysis);
    return a ? direct(p.prices, a) : 0;
  }
  return b.unitCost;
}

/** The rubro's coefficients (an empty list if it has none) */
export function coefsOf(h: Budget, rubro: number): Coef[] {
  return h.rubroCoefs.get(rubro) ?? [];
}

/** The factor from direct cost to price for an item: the project's × its rubro's × its own */
export function factor(p: Pricing, b: BudgetItem): number {
  return p.priceFactor * chain(coefsOf(p.budget, b.rubro)) * chain(b.coefs);
}

export function itemUnitPrice(p: Pricing, b: BudgetItem): number {
  return unitDirect(p, b) * factor(p, b);
}

export function itemTotal(p: Pricing, b: BudgetItem): number {
  return b.qty * itemUnitPrice(p, b);
}

export function itemDirectTotal(p: Pricing, b: BudgetItem): number {
  return b.qty * unitDirect(p, b);
}

/** [direct, price] of a rubro (0 = all) */
export function totals(p: Pricing, rubro = 0): [number, number] {
  let d = 0;
  let t = 0;
  for (const b of p.budget.items) {
    if (rubro && b.rubro !== rubro) continue;
    d += itemDirectTotal(p, b);
    t += itemTotal(p, b);
  }
  return [d, t];
}

/** The rubros the items are in, sorted */
export function usedRubros(h: Budget): number[] {
  return [...new Set(h.items.map((b) => b.rubro))].sort((x, y) => x - y);
}

/** What a person reads for an item */
export function descriptionOf(p: Pricing, b: BudgetItem): string {
  if (b.description) return b.description;
  if (b.analysis) return p.prices.analyses.get(b.analysis)?.name ?? tr("(missing analysis)");
  return "";
}

export function unitOf(p: Pricing, b: BudgetItem): string {
  if (b.unit) return b.unit;
  if (b.analysis) return p.prices.analyses.get(b.analysis)?.unit ?? "";
  return "";
}

/** What is wrong with an item, or "" */
export function itemProblem(p: Pricing, b: BudgetItem): string {
  if (b.analysis && !p.prices.analyses.has(b.analysis)) return tr("Its analysis doesn't exist");
  if (unitDirect(p, b) === 0) return tr("It has no cost");
  if (b.qty === 0) return tr("It has no quantity");
  if (overridden(b)) return tr("Quantity changed by hand (the design says &1)", b.designQty);
  return "";
}

// LOOKUPS AND ORDER

export function findItem(h: Budget, key: string): BudgetItem | undefined {
  return h.items.find((b) => b.id === key || b.code === key);
}

export function indexOfItem(h: Budget, id: string): number {
  return h.items.findIndex((b) => b.id === id);
}

/** Where a new item of a rubro goes: after the last of its rubro, or before the first of a later one */
export function insertPos(h: Budget, rubro: number): number {
  for (let i = h.items.length - 1; i >= 0; i--) if (h.items[i].rubro <= rubro) return i + 1;
  return 0;
}

/** The codes "rubro.order" (3.01, 3.02...), as the items are now */
export function renumber(h: Budget): void {
  const count = new Map<number, number>();
  for (const b of h.items) {
    const n = (count.get(b.rubro) ?? 0) + 1;
    count.set(b.rubro, n);
    b.code = `${b.rubro}.${String(n).padStart(2, "0")}`;
  }
}
