// Texts people read, and reading values that come from people or the AI.
//
// tr(text, a...) marks a text for translation and puts the arguments in (&1, &2... as Gambas's Subst), so the
// texts are the same as the Gambas version's and its Spanish (.lang/es.po) can be reused. The catalog is
// loaded by the server (setCatalog); without one the English text is used.

let catalog: Map<string, string> | null = null;

export function setCatalog(c: Map<string, string> | null): void {
  catalog = c;
}

/** The locale numbers and dates are written in: Spanish (Argentina) when the Spanish catalog is loaded */
export function locale(): string {
  return catalog ? "es-AR" : "en-US";
}

export function tr(text: string, ...args: unknown[]): string {
  const s = catalog?.get(text) || text;
  return s.replace(/&(\d)/g, (m, d) => {
    const i = Number(d) - 1;
    return i < args.length ? String(args[i]) : m;
  });
}

/** A value the command can't use: the message says which field */
export class BadValue extends Error {}

/** A number: a number, or a string that reads as one ("12.5"); else BadValue */
export function num(v: unknown, field: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === undefined || v === "") return 0;
  throw new BadValue(field);
}

export function int(v: unknown, field: string): number {
  return Math.trunc(num(v, field));
}

export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function bool(v: unknown): boolean {
  if (typeof v === "string") return v !== "" && v !== "0" && v.toLowerCase() !== "false";
  return Boolean(v);
}

/** Is v a plain object (a JSON object)? */
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Today as yyyy-mm-dd (local time) */
export function today(): string {
  return ymd(new Date());
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Now as yyyy-mm-dd hh:nn:ss (local time), as the Gambas version writes it */
export function nowStamp(): string {
  const d = new Date();
  return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
