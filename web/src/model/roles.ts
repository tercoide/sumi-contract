// Who may do what (decided 2026-11-18: the user manages the roles, for the company and for each project).
//
// A right is an area of the work (the prices, the budget, issuing certificates, payments...). A role is a set
// of rights with a name people know ("Presupuestista", "Dirección de obra"...). A person has roles in the
// company (they count in every project) and may have more in a project (a project's members). Everyone who can
// sign in can look at everything; changing needs the right. Admins manage the people and their roles.
//
// The commands know nothing of this: needs(command, args) says which right a command takes, and the session's
// rights (Session.rights) are checked before it runs. A session without rights (the tests, the computer's own
// user without logins) may do everything.

import { isObj } from "./text.ts";

export const RIGHTS = ["project", "prices", "budget", "schedule", "contracts", "certify", "payments", "contractors", "standard", "ai", "admin"] as const;
export type Right = (typeof RIGHTS)[number];

/** Each right's name, for people (shown with tr(): listed in scripts/i18n.mjs's RUNTIME) */
export const RIGHT_NAMES: Record<Right, string> = {
  project: "Project data",
  prices: "Prices",
  budget: "Budget",
  schedule: "Gantt",
  contracts: "Contracts",
  certify: "Issue certificates",
  payments: "Payments",
  contractors: "Contractors",
  standard: "Standard library",
  ai: "AI assistant",
  admin: "People and roles",
};

/** What each right lets do, for people (also in RUNTIME) */
export const RIGHT_TEXTS: Record<Right, string> = {
  project: "The project's data; new projects",
  prices: "Resources, analyses, rubros, labor charges, imports",
  budget: "Budget items and coefficients, the design's quantities",
  schedule: "The Gantt",
  contracts: "Contracts, their items and the certificates' measurements",
  certify: "Issue certificates (and take them back to draft)",
  payments: "Payments to the contractors",
  contractors: "The company's contractors and their documents",
  standard: "The company's standard price library",
  ai: "Ask the AI assistant (it can do what the person can)",
  admin: "People, roles and project members",
};

export interface Role {
  id: string;
  name: string; // in English: shown with tr()
  rights: Right[];
}

/** The roles (fixed for now; the user may want to make their own: a question for them) */
export const ROLES: Role[] = [
  { id: "admin", name: "Administrator", rights: [...RIGHTS] },
  { id: "director", name: "Site direction", rights: ["project", "budget", "schedule", "contracts", "certify", "ai"] },
  { id: "estimator", name: "Estimator", rights: ["project", "prices", "budget", "standard", "ai"] },
  { id: "planner", name: "Planner", rights: ["schedule", "ai"] },
  { id: "contracts", name: "Contracts administration", rights: ["contracts", "contractors", "ai"] },
  { id: "treasury", name: "Treasury", rights: ["payments"] },
  { id: "viewer", name: "Viewer", rights: [] },
];

export const roleIds = () => ROLES.map((r) => r.id);

export function rightsOf(roles: Iterable<string>): Set<Right> {
  const out = new Set<Right>();
  for (const id of roles) for (const r of ROLES.find((x) => x.id === id)?.rights ?? []) out.add(r);
  return out;
}

/** The commands that only read: anyone may run them */
const READING = new Set(["help", "info", "log", "change.get", "project.get", "book.get", "resource.list", "resource.get", "analysis.list", "analysis.get", "budget.list", "schedule.get", "contractor.list", "contractor.get", "contract.list", "contract.get", "design.rows", "report.pdf", "person.list", "member.list", "role.list"]);

const BY_COMMAND: Record<string, Right> = {
  "project.set": "project",
  "book.set": "prices",
  "rubro.set": "prices",
  "rubro.delete": "prices",
  "charge.add": "prices",
  "charge.set": "prices",
  "charge.delete": "prices",
  "resource.add": "prices",
  "resource.set": "prices",
  "resource.delete": "prices",
  "analysis.add": "prices",
  "analysis.set": "prices",
  "analysis.copy": "prices",
  "analysis.delete": "prices",
  "analysis.addline": "prices",
  "analysis.setline": "prices",
  "analysis.removeline": "prices",
  "analysis.flatten": "prices",
  "prices.import": "prices",
  "prices.fromstandard": "prices",
  "item.add": "budget",
  "item.set": "budget",
  "item.delete": "budget",
  "item.move": "budget",
  "rubro.coefs": "budget",
  "design.sync": "budget",
  "design.map": "budget",
  "task.set": "schedule",
  "schedule.suggest": "schedule",
  "contract.add": "contracts",
  "contract.set": "contracts",
  "contract.delete": "contracts",
  "part.add": "contracts",
  "part.set": "contracts",
  "part.remove": "contracts",
  "cert.add": "contracts",
  "cert.set": "contracts",
  "cert.delete": "contracts",
  "payment.add": "payments",
  "payment.set": "payments",
  "payment.delete": "payments",
  "contractor.add": "contractors",
  "contractor.set": "contractors",
  "contractor.delete": "contractors",
  "standard.export": "standard",
  "person.add": "admin",
  "person.set": "admin",
  "person.delete": "admin",
  "member.set": "admin",
};

/** The rights a command needs (none: it only reads; undo and redo are checked on what they undo). A command
 *  nobody listed needs admin, so a new command is never open by mistake. */
export function needs(command: string, args: Record<string, unknown> = {}): Right[] {
  const c = command.toLowerCase();
  if (READING.has(c) || c === "undo" || c === "redo") return [];
  // issuing a certificate, or taking it back to draft; measuring it too is the contracts' right
  if (c === "cert.set" && isObj(args) && "status" in args) return Object.keys(args).some((k) => !["contract", "cert", "status"].includes(k)) ? ["certify", "contracts"] : ["certify"];
  return [BY_COMMAND[c] ?? "admin"];
}

/** Every command the program has is either reading or listed (the test checks it) */
export function isListed(command: string): boolean {
  const c = command.toLowerCase();
  return READING.has(c) || c === "undo" || c === "redo" || c in BY_COMMAND;
}
