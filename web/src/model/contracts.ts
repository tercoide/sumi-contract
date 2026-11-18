// The contracts with the contractors: parts of budget items at agreed prices, the conditions (from the
// project by default: advance, guarantee retention, certificate period, adjustment index), certificates and
// payments. The advance is recovered in proportion to each certificate; the retention is kept from each and
// given back at the final reception; each certificate is adjusted by its month's index over the base index.
// (Port of Contracts, Contract, ContractPart, Certificate and Payment; the JSON is the Gambas file's.)

import { makeId } from "./ids.ts";
import { BadValue, int, isObj, num, str } from "./text.ts";

export const ADVANCE = "advance";
export const PROGRESS = "progress";
export const RETENTION = "retention";
export const CERT_KINDS = [ADVANCE, PROGRESS, RETENTION];
export const PAYMENT_MEANS = ["transfer", "cheque", "cash", "other"];

/** What a contract takes of a budget item: a quantity at the agreed unit price */
export interface ContractPart {
  id: string;
  item: string; // the budget item's id
  qty: number;
  unitPrice: number;
}

export interface Certificate {
  id: string;
  number: number;
  kind: string; // ADVANCE, PROGRESS or RETENTION
  period: string; // yyyy-mm
  date: string; // yyyy-mm-dd
  index: number; // the adjustment index of its month (0 = no adjustment)
  measures: Record<string, number>; // accumulated quantity measured, by part id
  status: string; // "draft", "issued"
  note: string;
}

export interface Payment {
  id: string;
  date: string;
  amount: number;
  means: string; // PAYMENT_MEANS
  reference: string; // the transfer's or the cheque's number
  certificate: string; // the certificate's id it pays ("" = on account)
  invoice: string;
  invoiceDate: string;
  note: string;
}

export interface Contract {
  id: string;
  code: string; // "C-01"
  contractor: string; // the contractor's id (company data)
  title: string;
  mode: string;
  advancePct: number;
  retentionPct: number;
  period: string;
  indexName: string; // "CAC"... ("" = fixed prices)
  baseIndex: number;
  baseMonth: string; // yyyy-mm
  signed: string; // yyyy-mm-dd
  note: string;
  parts: ContractPart[];
  certificates: Certificate[];
  payments: Payment[];
}

export function newContract(): Contract {
  return { id: makeId("t"), code: "", contractor: "", title: "", mode: "Unit prices", advancePct: 0, retentionPct: 5, period: "Monthly", indexName: "", baseIndex: 0, baseMonth: "", signed: "", note: "", parts: [], certificates: [], payments: [] };
}

export function newPart(item: string, qty: number, unitPrice: number): ContractPart {
  return { id: makeId("p"), item, qty, unitPrice };
}

export function newCertificate(): Certificate {
  return { id: makeId("q"), number: 0, kind: PROGRESS, period: "", date: "", index: 0, measures: {}, status: "draft", note: "" };
}

export function newPayment(): Payment {
  return { id: makeId("y"), date: "", amount: 0, means: "transfer", reference: "", certificate: "", invoice: "", invoiceDate: "", note: "" };
}

// THE FILE

export function contractToJson(k: Contract): Record<string, unknown> {
  const { parts, certificates, payments, ...fields } = k;
  return {
    ...fields,
    parts: parts.map((p) => ({ ...p })),
    certificates: certificates.map((q) => {
      const c: Record<string, unknown> = { id: q.id, number: q.number, kind: q.kind, period: q.period, date: q.date, index: q.index, measures: { ...q.measures }, status: q.status };
      if (q.note) c.note = q.note;
      return c;
    }),
    payments: payments.map((y) => ({ ...y })),
  };
}

export function contractFromJson(c: unknown): Contract {
  const k = newContract();
  if (!isObj(c)) return k;
  if (c.id) k.id = str(c.id);
  applyContract(k, c);
  if (Array.isArray(c.parts)) k.parts = c.parts.filter(isObj).map((p) => ({ id: str(p.id) || makeId("p"), item: str(p.item), qty: num(p.qty, "qty"), unitPrice: num(p.unitPrice, "unitPrice") }));
  if (Array.isArray(c.certificates))
    k.certificates = c.certificates.filter(isObj).map((o) => {
      const q = newCertificate();
      if (o.id) q.id = str(o.id);
      q.number = int(o.number, "number");
      q.kind = str(o.kind) || PROGRESS;
      q.period = str(o.period);
      q.date = str(o.date);
      q.index = num(o.index, "index");
      if (isObj(o.measures)) for (const [p, v] of Object.entries(o.measures)) q.measures[p] = num(v, "measures");
      q.status = str(o.status) || "draft";
      q.note = str(o.note);
      return q;
    });
  if (Array.isArray(c.payments))
    k.payments = c.payments.filter(isObj).map((o) => {
      const y = newPayment();
      if (o.id) y.id = str(o.id);
      applyPayment(y, o);
      return y;
    });
  return k;
}

export function contractsToJson(list: Contract[]): Record<string, unknown> {
  return { contracts: list.map(contractToJson) };
}

export function contractsFromJson(c: unknown): Contract[] {
  if (!isObj(c) || !Array.isArray(c.contracts)) return [];
  return c.contracts.map(contractFromJson);
}

const CONTRACT_NUMBERS = ["advancePct", "retentionPct", "baseIndex"];
const CONTRACT_TEXTS = ["code", "contractor", "title", "mode", "period", "indexName", "baseMonth", "signed", "note"];

/** Sets the fields present in c (not parts, certificates or payments); a field it doesn't know, or "" */
export function applyContract(k: Contract, c: Record<string, unknown>): string {
  for (const [key, v] of Object.entries(c)) {
    if (["id", "key", "parts", "certificates", "payments"].includes(key)) continue;
    try {
      if (CONTRACT_NUMBERS.includes(key)) (k as unknown as Record<string, number>)[key] = num(v, key);
      else if (CONTRACT_TEXTS.includes(key)) (k as unknown as Record<string, string>)[key] = str(v);
      else return key;
    } catch (e) {
      if (e instanceof BadValue) return key;
      throw e;
    }
  }
  return "";
}

export function applyPayment(y: Payment, c: Record<string, unknown>): string {
  for (const [key, v] of Object.entries(c)) {
    try {
      switch (key) {
        case "id":
        case "key":
        case "contract":
        case "index":
          break;
        case "amount":
          y.amount = num(v, key);
          break;
        case "date":
        case "means":
        case "reference":
        case "certificate":
        case "invoice":
        case "invoiceDate":
        case "note":
          (y as unknown as Record<string, string>)[key] = str(v);
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

// LOOKUPS

export function findContract(list: Contract[], key: string): Contract | undefined {
  return list.find((k) => k.id === key || k.code === key);
}

export function nextContractCode(list: Contract[]): string {
  let i = 0;
  for (const k of list) {
    if (!k.code.startsWith("C-")) continue;
    const n = Number(k.code.slice(2));
    if (Number.isInteger(n)) i = Math.max(i, n);
  }
  return "C-" + String(i + 1).padStart(2, "0");
}

export function findPart(k: Contract, key: string): ContractPart | undefined {
  return k.parts.find((p) => p.id === key || p.item === key);
}

export function findCert(k: Contract, key: string): Certificate | undefined {
  return k.certificates.find((q) => q.id === key || String(q.number) === String(key));
}

// THE NUMBERS

/** The contract's amount: its parts at the agreed prices */
export function amount(k: Contract): number {
  return k.parts.reduce((f, p) => f + p.qty * p.unitPrice, 0);
}

/** The accumulated quantity of a part measured by the progress certificates before q (all of them if q is null) */
export function measuredBefore(k: Contract, q: Certificate | null, part: string): number {
  let f = 0;
  for (const h of k.certificates) {
    if (h === q) break;
    if (h.kind === PROGRESS && part in h.measures) f = h.measures[part];
  }
  return f;
}

/** The accumulated quantity of a part after all the certificates */
export function measured(k: Contract, part: string): number {
  return measuredBefore(k, null, part);
}

/** A certificate's amounts: [work, adjustment, advance recovered, retention, net] */
export function numbers(k: Contract, q: Certificate): [number, number, number, number, number] {
  if (q.kind === ADVANCE) return [0, 0, 0, 0, (amount(k) * k.advancePct) / 100];
  if (q.kind === RETENTION) {
    let ret = 0;
    for (const h of k.certificates) if (h.kind === PROGRESS) ret += numbers(k, h)[3];
    return [0, 0, 0, 0, ret];
  }
  let work = 0;
  for (const p of k.parts) if (p.id in q.measures) work += (q.measures[p.id] - measuredBefore(k, q, p.id)) * p.unitPrice;
  const adj = k.baseIndex > 0 && q.index > 0 ? work * (q.index / k.baseIndex - 1) : 0;
  const adv = (work * k.advancePct) / 100;
  const ret = ((work + adj) * k.retentionPct) / 100;
  return [work, adj, adv, ret, work + adj - adv - ret];
}

/** What the issued certificates are worth, what was paid, and the difference */
export function balance(k: Contract): [number, number, number] {
  let due = 0;
  for (const q of k.certificates) if (q.status === "issued") due += numbers(k, q)[4];
  const paid = k.payments.reduce((f, y) => f + y.amount, 0);
  return [due, paid, due - paid];
}

/** The work certified, as a part of the contract (0 to 1) */
export function progress(k: Contract): number {
  const all = amount(k);
  if (all <= 0) return 0;
  return k.parts.reduce((f, p) => f + measured(k, p.id) * p.unitPrice, 0) / all;
}

/** How much of a budget item the contracts take */
export function assigned(list: Contract[], item: string): number {
  let f = 0;
  for (const k of list) for (const p of k.parts) if (p.item === item) f += p.qty;
  return f;
}

/** How much of a budget item has been measured in the certificates (-1 if no contract takes it) */
export function itemMeasured(list: Contract[], item: string): number {
  let f = 0;
  let any = false;
  for (const k of list)
    for (const p of k.parts)
      if (p.item === item) {
        f += measured(k, p.id);
        any = true;
      }
  return any ? f : -1;
}
