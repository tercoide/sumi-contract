// The link with sumi-designer (decided with the user 2026-11-17; port of DesignLink): the .designer-proj has the
// building's quantities, written by sumi-designer on every save ("quantities": rows with a "key" that doesn't
// change with the language), and the analyses of each row ("analyses": key -> [{code, factor}...]);
// sumi-designer is the master of that map. While it has none for a row, the project's budget.designMap can say it.
//
// The web version can't read the file where it is: the person uploads it (design.load) and the project keeps its
// quantities (Project.design) until the next one. sync turns them into budget items: one for each row and
// analysis (designRef = "row key#analysis code"), qtySource "design", designQty = the row's quantity × the
// factor. An item changed by hand keeps its quantity (and stays marked); a row that is gone leaves its items
// with designQty 0, said in the report.

import { insertPos, newItem, overridden, renumber, type Budget } from "./budget.ts";
import { analysisByCode, type PriceBook } from "./prices.ts";
import { isObj, num, str, tr } from "./text.ts";

export interface DesignRow {
  key: string;
  group: string;
  item: string;
  unit: string;
  qty: number;
}

export interface DesignRef {
  code: string;
  factor: number;
}

/** What the project keeps of the last .designer-proj uploaded */
export interface Design {
  name: string; // the file's name
  date: string; // when sumi-designer saved it
  loaded: string; // when it was uploaded
  rows: DesignRow[];
  map: Record<string, DesignRef[]>; // the designer's analyses of each row
}

const refs = (v: unknown): DesignRef[] => (Array.isArray(v) ? v.filter(isObj).map((a) => ({ code: str(a.code), factor: a.factor === undefined ? 1 : num(a.factor, "factor") })).filter((a) => a.code) : []);

export function designFromJson(c: unknown): Design | null {
  if (!isObj(c) || !Array.isArray(c.rows)) return null;
  const map: Record<string, DesignRef[]> = {};
  if (isObj(c.map)) for (const [k, v] of Object.entries(c.map)) map[k] = refs(v);
  return {
    name: str(c.name),
    date: str(c.date),
    loaded: str(c.loaded),
    rows: c.rows.filter(isObj).map((r) => ({ key: str(r.key), group: str(r.group), item: str(r.item), unit: str(r.unit), qty: num(r.qty, "qty") })),
    map,
  };
}

export const designToJson = (d: Design) => structuredClone(d) as unknown as Record<string, unknown>;

/** A .designer-proj's text -> its quantities, or why it can't be used */
export function readDesign(name: string, text: string, loaded: string): { design?: Design; error?: string } {
  let c: unknown;
  try {
    c = JSON.parse(text);
  } catch {
    return { error: tr("&1 can't be read.", name) };
  }
  if (!isObj(c) || !isObj(c.quantities) || !Array.isArray(c.quantities.rows))
    return { error: tr("&1 has no quantities: save it again with a sumi-designer that writes them (file version 42 or later).", name) };
  const d = designFromJson({ name, date: c.quantities.date, loaded, rows: c.quantities.rows, map: c.analyses });
  return d ? { design: d } : { error: tr("&1 can't be read.", name) };
}

/** The analyses of a row: the designer's, or else the project's; [] if none */
export function analysesOf(d: Design, h: Budget, key: string): { list: DesignRef[]; fromDesigner: boolean } {
  if (key in d.map && d.map[key].length) return { list: d.map[key], fromDesigner: true };
  return { list: refs(h.designMap[key]), fromDesigner: false };
}

const fmtQty = (f: number) => String(Math.round(f * 100) / 100);

/** Creates and updates the budget items from the design; the report says what it did */
export function syncDesign(d: Design, h: Budget, b: PriceBook): string[] {
  const seen = new Set<string>();
  let fresh = 0;
  let updated = 0;
  let kept = 0;
  let gone = 0;
  const unmapped: string[] = [];
  const unknown: string[] = [];
  for (const row of d.rows) {
    const { list } = analysesOf(d, h, row.key);
    if (!list.length) {
      unmapped.push(`${row.group}: ${row.item} (${fmtQty(row.qty)} ${row.unit})`);
      continue;
    }
    for (const ref of list) {
      const a = analysisByCode(b, ref.code);
      if (!a) {
        if (!unknown.includes(ref.code)) unknown.push(ref.code);
        continue;
      }
      const qty = row.qty * ref.factor;
      const designRef = row.key + "#" + a.code;
      seen.add(designRef);
      const item = h.items.find((x) => x.designRef === designRef);
      if (item) {
        if (overridden(item)) kept++;
        else {
          item.qty = qty;
          updated++;
        }
        item.designQty = qty;
        item.analysis = a.id;
      } else {
        const n = newItem();
        n.analysis = a.id;
        n.rubro = a.rubro;
        n.qty = qty;
        n.qtySource = "design";
        n.designQty = qty;
        n.designRef = designRef;
        h.items.splice(insertPos(h, n.rubro), 0, n);
        fresh++;
      }
    }
  }
  // what the design doesn't have anymore
  for (const item of h.items) {
    if (item.qtySource !== "design" || seen.has(item.designRef)) continue;
    if (item.designQty !== 0) gone++;
    item.designQty = 0;
  }
  renumber(h);
  const report = [tr("From the design (saved &1): &2 items new, &3 updated, &4 changed by hand kept.", d.date, fresh, updated, kept)];
  if (gone) report.push(tr("&1 items measure things the design doesn't have anymore: their design quantity is now 0 (orange).", gone));
  if (unknown.length) report.push(tr("Analyses the price book doesn't have: &1", unknown.join(", ")));
  if (unmapped.length) report.push(tr("&1 rows of the design have no analyses yet (give them in sumi-designer, or here in From the design):", unmapped.length), ...unmapped);
  return report;
}
