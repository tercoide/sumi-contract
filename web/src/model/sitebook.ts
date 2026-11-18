// The site book (libro de obra): what happens on the site, in writing, as an Argentine work keeps it.
//   daily    the daily report (parte diario): the weather, whether the day was workable, the people of each
//            contractor on site, what was done
//   order    a service order (orden de servicio): the site direction orders a contractor something
//   request  a request (nota de pedido): a contractor asks or says something to the site direction
// Orders and requests are numbered per contract (each contract has its books); daily reports per project.
// Once issued an entry can't change, except its reply (the other side answers it) and whether it is closed.
// (Not in the Gambas version: added 2026-11-18, the user asked for more features.)

import { makeId } from "./ids.ts";
import { bool, BadValue, int, isObj, num, str } from "./text.ts";

export const DAILY = "daily";
export const ORDER = "order";
export const REQUEST = "request";
export const ENTRY_KINDS = [DAILY, ORDER, REQUEST];
export const WEATHER = ["sunny", "cloudy", "rain", "storm", "wind", "cold", "heat"];

/** People of a contractor on site that day */
export interface Crew {
  contractor: string; // the contractor's id ("" = the company's own people)
  people: number;
}

export interface SiteEntry {
  id: string;
  kind: string; // DAILY, ORDER, REQUEST
  number: number; // per kind (and contract, for orders and requests)
  contract: string; // the contract's id ("" = the whole work)
  date: string; // yyyy-mm-dd
  subject: string;
  text: string;
  // a daily report
  weather: string; // WEATHER
  workable: boolean; // the day counted for the work (rain days don't)
  crews: Crew[];
  // an order or a request
  due: string; // by when it must be done or answered (yyyy-mm-dd, "" = no date)
  reply: string; // the other side's answer
  replied: string; // its date
  closed: boolean; // done / settled
  // both
  author: string; // who wrote it (a name, as the logs keep it)
  status: string; // "draft", "issued"
}

export function newEntry(kind = DAILY): SiteEntry {
  return { id: makeId("e"), kind, number: 0, contract: "", date: "", subject: "", text: "", weather: "", workable: true, crews: [], due: "", reply: "", replied: "", closed: false, author: "", status: "draft" };
}

/** The fields that can't change once issued */
export const LOCKED = ["kind", "contract", "date", "subject", "text", "weather", "workable", "crews", "due"];
const TEXTS = ["contract", "date", "subject", "text", "weather", "due", "reply", "replied", "author"];

/** Sets the fields present in c; a field it doesn't know or can't take, or "" */
export function applyEntry(e: SiteEntry, c: Record<string, unknown>): string {
  for (const [k, v] of Object.entries(c)) {
    try {
      if (TEXTS.includes(k)) (e as unknown as Record<string, string>)[k] = str(v);
      else if (k === "workable") e.workable = bool(v);
      else if (k === "closed") e.closed = bool(v);
      else if (k === "number") e.number = int(v, k);
      else if (k === "status") {
        if (v !== "draft" && v !== "issued") return k;
        e.status = v;
      } else if (k === "kind") {
        if (!ENTRY_KINDS.includes(str(v))) return k;
        e.kind = str(v);
      } else if (k === "crews") {
        if (!Array.isArray(v)) return k;
        e.crews = v.filter(isObj).map((x) => ({ contractor: str(x.contractor), people: num(x.people, "people") }));
      } else if (k !== "id") return k;
    } catch (err) {
      if (err instanceof BadValue) return k;
      throw err;
    }
  }
  return "";
}

export function entryToJson(e: SiteEntry): Record<string, unknown> {
  return { ...e, crews: e.crews.map((x) => ({ ...x })) };
}

export function entryFromJson(c: unknown): SiteEntry {
  const e = newEntry();
  if (!isObj(c)) return e;
  if (c.id) e.id = str(c.id);
  applyEntry(e, c);
  return e;
}

export const siteBookToJson = (list: SiteEntry[]) => list.map(entryToJson);
export const siteBookFromJson = (v: unknown): SiteEntry[] => (Array.isArray(v) ? v.map(entryFromJson) : []);

/** The next number of a kind (per contract for orders and requests) */
export function nextNumber(list: SiteEntry[], kind: string, contract: string): number {
  let n = 0;
  for (const e of list) if (e.kind === kind && (kind === DAILY || e.contract === contract)) n = Math.max(n, e.number);
  return n + 1;
}

/** An entry by id */
export function findEntry(list: SiteEntry[], key: string): SiteEntry | undefined {
  return list.find((e) => e.id === key);
}

/** Orders and requests still open, and those past their date */
export function pending(list: SiteEntry[], today: string): { open: SiteEntry[]; late: SiteEntry[] } {
  const open = list.filter((e) => e.kind !== DAILY && e.status === "issued" && !e.closed);
  return { open, late: open.filter((e) => e.due && e.due < today) };
}

/** Workable and lost days in the daily reports (rain days extend the work's deadline) */
export function dayCount(list: SiteEntry[]): { reports: number; workable: number; lost: number } {
  const days = new Map<string, boolean>();
  for (const e of list) if (e.kind === DAILY && e.date) days.set(e.date, (days.get(e.date) ?? false) || e.workable);
  let workable = 0;
  for (const w of days.values()) if (w) workable++;
  return { reports: days.size, workable, lost: days.size - workable };
}
