// The texts people read: tr(text, a...) as on the server (and the Gambas version's Subst). The language is
// the browser's (Spanish or English), or what the person chose (kept in this browser).

import es from "../../src/i18n/es.json";

const catalog: Record<string, string> = es;

function pick(): string {
  try {
    const saved = localStorage.getItem("sumi.lang");
    if (saved === "es" || saved === "en") return saved;
  } catch {}
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

export let lang = pick();

export function setLang(l: string): void {
  try {
    localStorage.setItem("sumi.lang", l);
  } catch {}
  location.reload();
}

export function tr(text: string, ...args: unknown[]): string {
  const s = (lang === "es" && catalog[text]) || text;
  return s.replace(/&(\d)/g, (m, d) => {
    const i = Number(d) - 1;
    return i < args.length ? String(args[i]) : m;
  });
}

const locale = () => (lang === "es" ? "es-AR" : "en-US");

/** A number with digits decimals, in the person's way */
export function fmt(n: unknown, digits = 2): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A quantity: as many decimals as it has, up to 4 */
export function qty(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return v.toLocaleString(locale(), { maximumFractionDigits: 4 });
}

/** Reads a number typed the person's way ("1.234,5" in Spanish) */
export function parseNum(s: string): number | null {
  let t = s.trim().replace(/\s/g, "");
  if (!t) return 0;
  if (lang === "es") t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
