// A building's paperwork: what a project holds (port of Project and Professional). Its JSON is the Gambas
// .contract-proj file's, so those files open here unchanged.

import { budgetFromJson, budgetToJson, newBudget, type Budget, type Pricing } from "./budget.ts";
import { changeFromJson, changeToJson, type Change } from "./change.ts";
import { contractsFromJson, contractsToJson, type Contract } from "./contracts.ts";
import { siteBookFromJson, siteBookToJson, type SiteEntry } from "./sitebook.ts";
import { designFromJson, designToJson, type Design } from "./design.ts";
import { addDays, isDay, isoWeekDay, parseDay, todayDay } from "./dates.ts";
import { bookFromJson, bookToJson, newBook, type PriceBook } from "./prices.ts";
import { newSchedule, scheduleFromJson, scheduleToJson, type Schedule } from "./schedule.ts";
import { int, isObj, nowStamp, num, str } from "./text.ts";

export interface Professional {
  role: string;
  name: string;
  registration: string; // professional registration number
  phone: string;
  email: string;
}

export const WORK_TYPES = ["New building", "Extension", "Renovation", "Extension and renovation", "Demolition", "Infrastructure"];
export const USAGES = ["Housing", "Multi-family housing", "Commercial", "Offices", "Industrial", "Educational", "Health", "Mixed", "Other"];
export const CONTRACT_MODES = ["Unit prices", "Lump sum", "Cost plus fee", "Labor only"];
export const CERTIFICATE_PERIODS = ["Weekly", "Biweekly", "Monthly", "By milestone"];

/** The project's own fields (what project.set takes), with their defaults; the order is the file's */
export function projectDefaults() {
  return {
    name: "",
    code: "",
    workType: "New building",
    use: "Housing",
    designFile: "",
    notes: "",
    location: "",
    city: "",
    province: "",
    parcel: "",
    plotArea: 0,
    coveredArea: 0,
    semiCoveredArea: 0,
    floors: 1,
    client: "",
    clientTaxId: "",
    clientPhone: "",
    clientEmail: "",
    professionals: [] as Professional[],
    holidays: [] as string[], // non-working days besides the weekly rest (sorted yyyy-mm-dd)
    startDate: todayDay(), // first day of work
    durationDays: 180, // working days available for the construction
    workDaysPerWeek: 5, // 5: Monday to Friday, 6: also Saturday, 7: every day
    hoursPerDay: 8, // working hours a day, to turn labor hours into days
    currency: "$",
    overheadPct: 15, // general expenses of the work and the company
    profitPct: 10,
    taxesPct: 21, // VAT and other taxes on the price
    contractMode: "Unit prices",
    advancePct: 0,
    retentionPct: 5,
    certificatePeriod: "Monthly",
    adjustmentIndex: "", // the price index the contracts are adjusted by ("" = fixed prices)
    adjustmentBase: "", // its base month (yyyy-mm)
    guaranteeDays: 365, // from the provisional to the final reception
  };
}

export type ProjectFields = ReturnType<typeof projectDefaults>;
export const PROJECT_FIELDS = Object.keys(projectDefaults()) as (keyof ProjectFields)[];

/** A person's roles in this project only (besides their roles in the company) */
export interface Member {
  person: string; // the person's id (company data)
  roles: string[];
}

export interface Project extends ProjectFields, Pricing {
  id: string;
  members: Member[];
  design: Design | null; // the quantities of the last .designer-proj uploaded (design.load)
  siteBook: SiteEntry[]; // daily reports, service orders, requests (sitebook.ts)
  prices: PriceBook;
  budget: Budget;
  schedule: Schedule;
  contracts: Contract[];
  changes: Change[]; // the change log: every change made through the commands
  created: string;
  modified: string;
  priceFactor: number; // kept up to date by setFields (overhead, profit, taxes)
}

export function newProject(id = ""): Project {
  const p: Project = {
    ...projectDefaults(),
    id,
    members: [],
    design: null,
    siteBook: [],
    prices: newBook(),
    budget: newBudget(),
    schedule: newSchedule(),
    contracts: [],
    changes: [],
    created: nowStamp(),
    modified: nowStamp(),
    priceFactor: 1,
  };
  p.priceFactor = priceFactor(p);
  return p;
}

/** A new project for a company: it starts with a copy of the company's standard library (as licita2003 made a
 *  new xls for each contract), or the default labor charges */
export function startProject(standard: PriceBook | null, id = ""): Project {
  const p = newProject(id);
  if (standard) p.prices = bookFromJson(newBook(), bookToJson(standard));
  return p;
}

/** The factor that turns a direct cost into a price: direct + overhead, + profit over that, + taxes over that */
export function priceFactor(p: ProjectFields): number {
  return (1 + p.overheadPct / 100) * (1 + p.profitPct / 100) * (1 + p.taxesPct / 100);
}

/** Is day d (yyyy-mm-dd) a working day? Monday first: 5 days = Mon-Fri, 6 = Mon-Sat, 7 = all */
export function isWorkDay(p: ProjectFields, d: string): boolean {
  if (isoWeekDay(d) > p.workDaysPerWeek) return false;
  return !p.holidays.includes(d);
}

/** The last working day: durationDays working days counted from startDate (startDate itself if it is one) */
export function endDate(p: ProjectFields): string {
  if (p.workDaysPerWeek < 1 || p.workDaysPerWeek > 7) return p.startDate;
  let left = Math.max(1, p.durationDays);
  let d = p.startDate;
  for (;;) {
    if (isWorkDay(p, d) && --left === 0) return d;
    d = addDays(d, 1);
  }
}

/** Sets the project's own fields present in c (as in the file). Returns a field it doesn't know or can't take, or "". */
export function setFields(p: Project, c: Record<string, unknown>): string {
  const d = projectDefaults() as Record<string, unknown>;
  for (const [key, v] of Object.entries(c)) {
    if (!(key in d)) return key;
    const def = d[key];
    try {
      if (key === "professionals") {
        if (!Array.isArray(v)) return key;
        p.professionals = v.filter(isObj).map((w) => ({ role: str(w.role), name: str(w.name), registration: str(w.registration), phone: str(w.phone), email: str(w.email) }));
      } else if (key === "holidays") {
        if (!Array.isArray(v)) return key;
        p.holidays = [...new Set(v.map((x) => str(x).slice(0, 10)).filter(isDay))].sort();
      } else if (key === "startDate") {
        const s = str(v).slice(0, 10);
        if (!parseDay(s)) return key;
        p.startDate = s;
      } else if (key === "floors" || key === "durationDays" || key === "workDaysPerWeek" || key === "guaranteeDays") {
        (p as unknown as Record<string, number>)[key] = int(v, key);
      } else if (typeof def === "number") {
        (p as unknown as Record<string, number>)[key] = num(v, key);
      } else {
        (p as unknown as Record<string, string>)[key] = str(v);
      }
    } catch {
      return key;
    }
  }
  p.priceFactor = priceFactor(p);
  return "";
}

/** The project's own fields as JSON (no prices, budget, schedule, contracts or log) */
export function fieldsToJson(p: Project): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const k of PROJECT_FIELDS) c[k] = structuredClone(p[k]);
  return c;
}

/** The whole project as the file holds it */
export function projectToJson(p: Project): Record<string, unknown> {
  return {
    ...fieldsToJson(p),
    prices: bookToJson(p.prices),
    budget: budgetToJson(p.budget),
    schedule: scheduleToJson(p.schedule),
    contracts: contractsToJson(p.contracts),
    // (only when there are: the Gambas version doesn't know them)
    ...(p.members.length ? { members: membersToJson(p.members) } : {}),
    ...(p.design ? { design: designToJson(p.design) } : {}),
    ...(p.siteBook.length ? { siteBook: siteBookToJson(p.siteBook) } : {}),
    changes: p.changes.map(changeToJson),
    created: p.created,
    modified: p.modified,
  };
}

export const membersToJson = (list: Member[]) => list.map((m) => ({ person: m.person, roles: [...m.roles] }));

export function membersFromJson(v: unknown): Member[] {
  return Array.isArray(v) ? v.filter(isObj).map((m) => ({ person: str(m.person), roles: Array.isArray(m.roles) ? m.roles.map(String) : [] })).filter((m) => m.person) : [];
}

/** A project from a file's JSON; what is missing keeps its default */
export function projectFromJson(c: unknown, id = ""): Project {
  const p = newProject(id);
  if (!isObj(c)) return p;
  const fields: Record<string, unknown> = {};
  for (const k of PROJECT_FIELDS) if (k in c) fields[k] = c[k];
  setFields(p, fields);
  if ("prices" in c) p.prices = bookFromJson(newBook(), c.prices);
  if ("budget" in c) p.budget = budgetFromJson(c.budget);
  if ("schedule" in c) p.schedule = scheduleFromJson(c.schedule);
  if ("contracts" in c) p.contracts = contractsFromJson(c.contracts);
  p.members = membersFromJson(c.members);
  p.design = designFromJson(c.design);
  p.siteBook = siteBookFromJson(c.siteBook);
  if (Array.isArray(c.changes)) p.changes = c.changes.map(changeFromJson);
  if (c.created) p.created = str(c.created);
  if (c.modified) p.modified = str(c.modified);
  return p;
}
