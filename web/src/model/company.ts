// The company's data, shared by all its projects: its contractors with their documents, and its standard
// price library (every new project starts with a copy; a project can export its prices back). It has its own
// change log. (Port of Company, Contractor and ContractorDoc; the JSON is the Gambas files'.)

import { changeFromJson, changeToJson, type Change } from "./change.ts";
import { daysBetween, parseDay, todayDay } from "./dates.ts";
import { makeId } from "./ids.ts";
import { bookFromJson, bookToJson, newBook, type PriceBook } from "./prices.ts";
import { isObj, str } from "./text.ts";

/** A document a contractor must keep valid: insurance, ART, tax certificates (AFIP), the union's... */
export interface ContractorDoc {
  kind: string;
  number: string;
  expires: string; // yyyy-mm-dd ("" = doesn't expire)
  file: string; // where its copy is
  note: string;
}

export interface Contractor {
  id: string;
  name: string;
  trade: string; // the speciality: "masonry", "electrical", "plumbing"...
  taxId: string; // CUIT
  contact: string;
  phone: string;
  email: string;
  address: string;
  bank: string; // CBU / alias, for payments
  docs: ContractorDoc[];
  note: string;
}

export interface Company {
  contractors: Map<string, Contractor>;
  standard: PriceBook | null; // the standard library (null = there is none yet)
  changes: Change[];
}

export function newCompany(): Company {
  return { contractors: new Map(), standard: null, changes: [] };
}

export function newContractor(): Contractor {
  return { id: makeId("k"), name: "", trade: "", taxId: "", contact: "", phone: "", email: "", address: "", bank: "", docs: [], note: "" };
}

const CONTRACTOR_TEXTS = ["name", "trade", "taxId", "contact", "phone", "email", "address", "bank", "note"];

export function docFromJson(c: unknown): ContractorDoc {
  const o = isObj(c) ? c : {};
  return { kind: str(o.kind), number: str(o.number), expires: str(o.expires), file: str(o.file), note: str(o.note) };
}

/** Sets the fields present in c; a field it doesn't know, or "" */
export function applyContractor(k: Contractor, c: Record<string, unknown>): string {
  for (const [key, v] of Object.entries(c)) {
    if (key === "id" || key === "key") continue;
    if (CONTRACTOR_TEXTS.includes(key)) (k as unknown as Record<string, string>)[key] = str(v);
    else if (key === "docs") {
      if (!Array.isArray(v)) return key;
      k.docs = v.map(docFromJson);
    } else return key;
  }
  return "";
}

export function contractorToJson(k: Contractor): Record<string, unknown> {
  return { id: k.id, name: k.name, trade: k.trade, taxId: k.taxId, contact: k.contact, phone: k.phone, email: k.email, address: k.address, bank: k.bank, docs: k.docs.map((d) => ({ ...d })), note: k.note };
}

export function contractorFromJson(c: unknown): Contractor {
  const k = newContractor();
  if (!isObj(c)) return k;
  if (c.id) k.id = str(c.id);
  applyContractor(k, c);
  return k;
}

/** Expired, or expiring within days */
export function expiresWithin(d: ContractorDoc, days: number): boolean {
  if (!d.expires || !parseDay(d.expires)) return false;
  return daysBetween(todayDay(), d.expires) <= days;
}

/** Documents expired or expiring within days (15: what the screens show in red) */
export function docsDue(k: Contractor, days = 15): ContractorDoc[] {
  return k.docs.filter((d) => expiresWithin(d, days));
}

/** The contractor with this id or name */
export function findContractor(co: Company, key: string): Contractor | undefined {
  const k = co.contractors.get(key);
  if (k) return k;
  const low = key.toLowerCase();
  for (const x of co.contractors.values()) if (x.name.toLowerCase() === low) return x;
}

export function sortedContractors(co: Company): Contractor[] {
  return [...co.contractors.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.id < b.id ? -1 : 1));
}

// THE FILES: contractors.json, standard.json and log.json, as the Gambas version keeps them

export function companyToFiles(co: Company): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "contractors.json": { contractors: [...co.contractors.values()].map(contractorToJson) },
    "log.json": { changes: co.changes.map(changeToJson) },
  };
  if (co.standard) out["standard.json"] = bookToJson(co.standard);
  return out;
}

export function companyFromFiles(files: Record<string, unknown>): Company {
  const co = newCompany();
  const c = files["contractors.json"];
  if (isObj(c) && Array.isArray(c.contractors))
    for (const v of c.contractors) {
      const k = contractorFromJson(v);
      co.contractors.set(k.id, k);
    }
  if (isObj(files["standard.json"])) co.standard = bookFromJson(newBook(), files["standard.json"]);
  const l = files["log.json"];
  if (isObj(l) && Array.isArray(l.changes)) co.changes = l.changes.map(changeFromJson);
  return co;
}
