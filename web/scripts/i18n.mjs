// The Spanish of the web version: every text written tr("...") in src/ and client/src/ is looked up in the
// Gambas version's translation (../.lang/es.po) and in the web's own (i18n/es.po), and the catalog
// src/i18n/es.json is written with what is used. Texts with no Spanish are added to i18n/es.po with an empty
// msgstr and listed: fill them in and run it again (npm run i18n) until it says 0. npm test fails while any
// text has no Spanish.
//
// Values translated at run time (tr(kind)...) are listed in RUNTIME below.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = [
  // the roles and rights (model/roles.ts)
  "Site manager", "Site book", "Service orders", "Daily reports and requests in the site book; replying to orders", "Issue service orders to the contractors; replying to requests",
  "daily", "order", "request", "sunny", "cloudy", "rain", "storm", "wind", "cold", "heat",
  "Administrator", "Site direction", "Estimator", "Planner", "Contracts administration", "Treasury", "Viewer",
  "Project data", "Prices", "Budget", "Gantt", "Contracts", "Issue certificates", "Payments", "Contractors", "Standard library", "AI assistant", "People and roles",
  "The project's data; new projects", "Resources, analyses, rubros, labor charges, imports", "Budget items and coefficients, the design's quantities", "The Gantt",
  "Contracts, their items and the certificates' measurements", "Issue certificates (and take them back to draft)", "Payments to the contractors",
  "The company's contractors and their documents", "The company's standard price library", "Ask the AI assistant (it can do what the person can)", "People, roles and project members",
  // the choices of the Project tab's lists (model/project.ts) and its professionals' roles
  "New building", "Extension", "Renovation", "Extension and renovation", "Demolition", "Infrastructure",
  "Housing", "Multi-family housing", "Commercial", "Offices", "Industrial", "Educational", "Health", "Mixed", "Other",
  "Unit prices", "Lump sum", "Cost plus fee", "Labor only", "Weekly", "Biweekly", "Monthly", "By milestone",
  "Design", "Structural engineering", "Site direction", "Builder", "Installations", "Safety and hygiene",
  // kinds, statuses and how a change was made
 "material", "labor", "equipment", "advance", "progress", "retention", "draft", "issued", "transfer", "cheque", "cash", "other", "person", "ai", "import", "system"];

/** msgid -> msgstr of a .po file */
export function readPo(file) {
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  let id = null;
  let str = null;
  let cur = null;
  const flush = () => {
    if (id !== null && id !== "") out.set(id, str ?? "");
    id = str = cur = null;
  };
  const unquote = (s) => JSON.parse(s.replace(/\\(?!["\\nt])/g, "\\\\"));
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("msgid ")) {
      flush();
      id = unquote(line.slice(6));
      cur = "id";
    } else if (line.startsWith("msgstr ")) {
      str = unquote(line.slice(7));
      cur = "str";
    } else if (line.startsWith('"')) {
      if (cur === "id") id += unquote(line);
      else if (cur === "str") str += unquote(line);
    } else if (line === "") flush();
  }
  flush();
  return out;
}

const quote = (s) => JSON.stringify(s);

/** The tr("...") texts of the source files */
export function usedTexts() {
  const texts = new Set(RUNTIME);
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f.name)) {
        const src = fs.readFileSync(p, "utf8");
        for (const m of src.matchAll(/\btr\(\s*("(?:[^"\\]|\\.)*")/g)) texts.add(JSON.parse(m[1]));
      }
    }
  };
  walk(path.join(web, "src"));
  walk(path.join(web, "client/src"));
  return texts;
}

export function build() {
  const gambas = readPo(path.join(web, "../.lang/es.po"));
  const ownFile = path.join(web, "i18n/es.po");
  const own = readPo(ownFile);
  const catalog = {};
  const missing = [];
  for (const t of [...usedTexts()].sort()) {
    const es = own.get(t) || gambas.get(t);
    if (es) catalog[t] = es;
    else missing.push(t);
  }
  // the missing ones go to the web's .po, to be filled in
  const add = missing.filter((t) => !own.has(t));
  if (add.length) {
    fs.mkdirSync(path.dirname(ownFile), { recursive: true });
    let text = fs.existsSync(ownFile) ? fs.readFileSync(ownFile, "utf8") : "# The Spanish of the web version's own texts (those not in ../.lang/es.po). npm run i18n\n\n";
    for (const t of add) text += `msgid ${quote(t)}\nmsgstr ""\n\n`;
    fs.writeFileSync(ownFile, text);
  }
  fs.mkdirSync(path.join(web, "src/i18n"), { recursive: true });
  fs.writeFileSync(path.join(web, "src/i18n/es.json"), JSON.stringify(catalog, null, 0) + "\n");
  return { count: Object.keys(catalog).length, missing };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { count, missing } = build();
  console.log(`Spanish: ${count} texts, ${missing.length} to translate${missing.length ? " (in i18n/es.po):" : "."}`);
  for (const t of missing) console.log("  " + t);
  process.exitCode = missing.length ? 1 : 0;
}
