// The core's checks, ported from the Gambas smoke test (.src/Tests/SmokeTest.module): the same numbers must
// come out. npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import * as B from "../src/model/budget.ts";
import { AI, PERSON, type Who } from "../src/model/change.ts";
import { beginGroup, endGroup, help, run, type Args, type Session } from "../src/model/cmd.ts";
import * as Co from "../src/model/company.ts";
import * as K from "../src/model/contracts.ts";
import { addDays, todayDay } from "../src/model/dates.ts";
import { makeId } from "../src/model/ids.ts";
import * as P from "../src/model/prices.ts";
import { endDate, newProject, projectFromJson, projectToJson, setFields, startProject, type Project } from "../src/model/project.ts";
import * as S from "../src/model/schedule.ts";

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

function person(name = "Tester", userId = "u-tester"): Who {
  return { name, userId, via: PERSON, model: "" };
}

function session(p: Project | null = newProject("p-test"), company = Co.newCompany()): Session {
  return { project: p, company, who: person(), group: "" };
}

/** run, and fail the test if the command fails */
function must(s: Session, command: string, args: Args = {}) {
  const r = run(s, command, args);
  assert.ok(r.ok, `${command}: ${JSON.stringify(r)}`);
  return r as Record<string, any>;
}

const fails = (s: Session, command: string, args: Args = {}) => "error" in run(s, command, args);

/** A file round trip: what is saved is what is read */
const reload = (p: Project) => projectFromJson(JSON.parse(JSON.stringify(projectToJson(p))), p.id);

test("ids", () => {
  const seen = new Set<string>();
  let s = "";
  for (let i = 0; i < 2000; i++) seen.add((s = makeId("r")));
  assert.equal(seen.size, 2000, "2000 ids are all different");
  assert.match(s, /^r-[0-9a-z]{12}$/);
  assert.ok(makeId("r") > "r-" + "0".repeat(12), "ids sort");
});

test("the calendar and the price factor", () => {
  const p = newProject();
  setFields(p, { startDate: "2026-11-16", workDaysPerWeek: 5, durationDays: 5 }); // a Monday
  assert.equal(endDate(p), "2026-11-20", "5 working days from Monday end on Friday");
  setFields(p, { durationDays: 6 });
  assert.equal(endDate(p), "2026-11-23", "the 6th working day is the next Monday");
  setFields(p, { workDaysPerWeek: 6 });
  assert.equal(endDate(p), "2026-11-21", "with Saturdays, the 6th is Saturday");
  setFields(p, { holidays: ["2026-11-18", "2026-11-18"] });
  assert.equal(endDate(p), "2026-11-23", "a holiday moves the end a day");
  assert.equal(p.holidays.length, 1, "the same holiday twice");
  setFields(p, { startDate: "2026-11-15", durationDays: 1 }); // a Sunday
  assert.equal(endDate(p), "2026-11-16", "starting on Sunday, the first day is Monday");
  setFields(p, { overheadPct: 10, profitPct: 10, taxesPct: 0 });
  assert.ok(near(p.priceFactor, 1.21), "price factor 10% + 10%");
});

test("the project file", () => {
  const p = newProject("p-1");
  const bad = setFields(p, {
    name: "Casa Alejandro",
    client: "Alejandro",
    location: "Lote 60",
    code: "OB-001",
    use: "Commercial",
    coveredArea: 182.5,
    floors: 2,
    clientTaxId: "20-12345678-9",
    retentionPct: 7.5,
    adjustmentIndex: "CAC",
    holidays: ["2026-12-25", "2026-12-08"],
    professionals: [{ role: "Design", name: "Arq. X", registration: "1234" }],
    notes: 'two lines\nof notes, with "quotes" and ñ',
    designFile: "/tmp/x.designer-proj",
  });
  assert.equal(bad, "");
  const q = reload(p);
  assert.deepEqual(projectToJson(q), projectToJson(p), "everything after load");
  assert.deepEqual(q.holidays, ["2026-12-08", "2026-12-25"], "holidays sorted");
  assert.equal(setFields(q, { startDate: "2026-02-31" }), "startDate", "a bad date is refused");
});

// A small book: cement, sand, a laborer, a machine; mortar; masonry using mortar
function smallBook() {
  const b = P.newBook();
  const ids: Record<string, string> = {};
  const add = (code: string, name: string, unit: string, kind: string, price: number) => {
    const r = P.newResource();
    Object.assign(r, { code, name, unit, kind, price });
    b.resources.set(r.id, r);
    ids[code] = r.id;
    return r;
  };
  add("2001", "cement", "t", P.MATERIAL, 100);
  add("3001", "sand", "m3", P.MATERIAL, 10).loss = 10;
  Object.assign(add("90009", "ayudante", "h", P.LABOR, 3), { override: true, wage: 1.36 });
  // licita2003's "equ" row 1
  Object.assign(add("100001", "excavadora", "h", P.EQUIPMENT, 90), { override: true, machine: { ...P.newMachine(), power: 110, cost: 390000, fuelPrice: 1.35 } });
  const a1 = P.newAnalysis();
  Object.assign(a1, { code: "1", name: "mortar", unit: "m3", laborYield: 2 });
  a1.lines.push({ isAnalysis: false, ref: ids["2001"], qty: 0.3 }, { isAnalysis: false, ref: ids["3001"], qty: 1 }, { isAnalysis: false, ref: ids["90009"], qty: 4 });
  b.analyses.set(a1.id, a1);
  const a2 = P.newAnalysis();
  Object.assign(a2, { code: "2", name: "masonry", unit: "m2" });
  a2.lines.push({ isAnalysis: true, ref: a1.id, qty: 0.5 }, { isAnalysis: false, ref: ids["100001"], qty: 0.1 }, { isAnalysis: false, ref: ids["2001"], qty: 0.1 });
  b.analyses.set(a2.id, a2);
  return { b, ids, a1, a2 };
}

test("the price model", () => {
  const { b, ids, a1, a2 } = smallBook();
  const res = (code: string) => b.resources.get(ids[code])!;
  // mortar: A = 0.3 * 100 + 1 * 10 * 1.1 = 41; C = 4 * 3 / 2 = 6
  let f = P.parts(b, a1);
  assert.ok(near(f[0], 41) && f[1] === 0 && near(f[2], 6), "mortar parts: " + f);
  // masonry: 0.5 mortar (A 20.5, C 3) + 0.1 h machine (B 9) + 0.1 t cement (A 10)
  f = P.parts(b, a2);
  assert.ok(near(f[0], 30.5) && near(f[1], 9) && near(f[2], 3), "masonry parts, with the linked mortar: " + f);
  assert.ok(near(P.direct(b, a2), 42.5), "masonry direct cost");
  assert.ok(near(P.lineCost(b, a2, a2.lines[0]), 0.5 * 47), "the cost of a sub-analysis line");

  res("2001").price = 200;
  assert.ok(near(P.parts(b, a2)[0], 55.5), "a sub-analysis is linked");
  b.updateCoef = 2;
  assert.ok(near(P.direct(b, a2), 135), "the update coefficient applies to every price");
  b.updateCoef = 1;
  res("2001").price = 100;

  // licita2003's equ row 1 = 104.9295 $/h; labor 1.36 + 43.2% + 200/176 + 60/1056
  assert.ok(near(P.calculatedPrice(b, res("100001")), 104.9295, 1e-6), "machine per hour");
  assert.ok(near(P.calculatedPrice(b, res("90009")), 1.36 * 1.432 + 200 / 176 + 60 / 1056), "labor per hour");
  assert.equal(P.priceOf(b, res("90009")), 3, "an override keeps the typed price");
  res("90009").override = false;
  assert.ok(near(P.priceOf(b, res("90009")), P.calculatedPrice(b, res("90009"))), "without override, the calculation");
  res("90009").override = true;

  // freight: 0.85 $/km x 1000 km / 6 = 141.67 a unit (licita2003's Notas)
  Object.assign(res("3001"), { distance: 1000, truckLoad: 6 });
  assert.ok(near(P.freight(b, res("3001")), 850 / 6), "freight a unit");
  assert.ok(near(P.priceOf(b, res("3001")), (10 + 850 / 6) * 1.1), "freight is part of the price, before losses");
  res("3001").distance = 0;

  assert.deepEqual(P.problems(b, a2), [], "masonry has no problems");
  a1.lines.push({ isAnalysis: true, ref: a2.id, qty: 1 });
  assert.ok(P.problems(b, a1).length > 0, "a loop is a problem");
  P.parts(b, a1); // a loop ends
  a1.lines.pop();
  a2.lines.push({ isAnalysis: false, ref: "r-nothing", qty: 1 });
  assert.equal(P.problems(b, a2).length, 1, "a missing resource is a problem");
  a2.lines.pop();
  assert.deepEqual(P.usedBy(b, a1.id, true), [a2], "usedBy: mortar is used by masonry");
  assert.equal(P.nextResourceCode(b, P.LABOR), "MO-0001");
  assert.equal(P.nextAnalysisCode(b), "AN-0001");
  assert.equal(P.findResource(b, "2001"), P.findResource(b, ids["2001"]), "found by code and by id");
  const sorted = P.sortedByCode(b.resources.values());
  assert.ok(sorted[0].code === "2001" && sorted[3].code === "100001", "sorted by code as numbers");

  // flatten: masonry becomes cement, sand, ayudante, machine; the mortar's labor yield is lost
  f = P.parts(b, a2);
  P.flatten(b, a2);
  assert.equal(a2.lines.length, 4, "flatten merges the resources");
  assert.ok(near(P.direct(b, a2), f[0] + f[1] + f[2] * 2), "flatten: the labor yield of the mortar is lost, as in licita2003");

  // the file
  const p = newProject();
  p.prices = smallBook().b;
  const q = reload(p);
  assert.ok(q.prices.resources.size === 4 && q.prices.analyses.size === 2 && q.prices.charges.length === 10, "prices after load");
  const a2q = P.analysisByCode(q.prices, "2")!;
  assert.ok(near(P.direct(q.prices, a2q), 42.5), "the same cost after load");
  assert.ok(a2q.lines[0].isAnalysis, "a sub-analysis line after load");
  assert.ok(near(P.calculatedPrice(q.prices, P.resourceByCode(q.prices, "100001")!), 104.9295, 1e-6), "a machine after load");
  const ayu = P.resourceByCode(q.prices, "90009")!;
  assert.ok(ayu.override && ayu.wage === 1.36, "override and wage after load");
});

test("the commands, the log, undo and redo", () => {
  const s = session();
  const p = s.project!;
  let c = must(s, "project.set", { name: "Obra 1", overheadPct: 20 });
  assert.ok(p.name === "Obra 1" && p.overheadPct === 20 && near(p.priceFactor, 1.2 * 1.1 * 1.21), "project.set");
  assert.ok(fails(s, "project.set", { nonsense: 1 }), "project.set refuses an unknown field");
  assert.ok(fails(s, "project.set", { name: "x", floors: "many" }) && p.name === "Obra 1", "a bad value changes nothing");
  assert.ok(p.changes.length === 1 && p.changes[0].who === "Tester" && p.changes[0].via === PERSON, "the change is logged with who");
  must(s, "project.set", { name: "Obra 12" });
  must(s, "project.set", { name: "Obra 123" });
  assert.ok((p.changes.length as number) === 2 && (p.changes[1].before.project as any).name === "Obra 1", "edits of one field in a row are one change");

  c = must(s, "resource.add", { kind: "material", name: "cemento", unit: "kg", price: 0.25 });
  const mat = c.id;
  assert.equal(c.code, "MAT-0001", "resource.add gives an id and a code");
  assert.ok(fails(s, "resource.add", { kind: "nonsense", name: "x" }), "resource.add refuses a bad kind");
  c = must(s, "analysis.add", { name: "mezcla", unit: "m3", lines: [{ resource: "MAT-0001", qty: 300 }] });
  const ana = c.id;
  assert.ok(near(P.direct(p.prices, p.prices.analyses.get(ana)!), 75), "analysis.add with a line by code");
  c = must(s, "analysis.get", { key: c.code });
  assert.ok(near(c.analysis.direct, 75) && c.analysis.lines[0].code === "MAT-0001", "analysis.get describes it");
  assert.ok(fails(s, "analysis.addline", { key: ana, analysis: ana, qty: 1 }), "a loop is refused");
  assert.ok(fails(s, "resource.delete", { key: mat }), "a used resource can't be deleted");
  must(s, "resource.set", { key: "MAT-0001", price: 0.5 });
  assert.ok(near(P.direct(p.prices, p.prices.analyses.get(ana)!), 150), "resource.set changes the analyses");
  assert.equal(p.prices.resources.get(mat)!.updated, todayDay(), "a new price gets today's date");
  assert.ok(fails(s, "resource.set", { key: mat, wrong: 1 }) && p.prices.resources.get(mat)!.price === 0.5, "a bad field changes nothing");
  assert.ok(fails(s, "resource.set", { key: mat, price: "cheap" }), "a bad value is refused");
  assert.equal(must(s, "resource.list", { text: "cem" }).resources.length, 1, "resource.list filters");
  assert.ok(must(s, "analysis.list").analyses[0].price > 150, "analysis.list gives prices");

  // undo and redo
  const n = p.changes.length;
  must(s, "undo");
  assert.equal(p.prices.resources.get(mat)!.price, 0.25, "undo puts the price back");
  assert.ok(p.changes.length === n + 1 && p.changes[n - 1].undoneBy !== "", "undo is a new entry and marks the undone one");
  must(s, "redo");
  assert.equal(p.prices.resources.get(mat)!.price, 0.5, "redo");
  assert.ok(fails(s, "redo"), "nothing more to redo");
  must(s, "undo");
  assert.equal(p.prices.resources.get(mat)!.price, 0.25, "undo again after a redo");
  must(s, "redo");

  // an AI group is undone at once
  s.who = { ...person(), via: AI, model: "claude-test" };
  beginGroup(s);
  must(s, "resource.set", { key: mat, price: 1 });
  must(s, "analysis.set", { key: ana, name: "mezcla AI" });
  endGroup(s);
  s.who = person();
  const last = p.changes[p.changes.length - 1];
  assert.ok(last.via === AI && last.model === "claude-test", "the AI's changes say so");
  must(s, "undo");
  assert.ok(p.prices.resources.get(mat)!.price === 0.5 && p.prices.analyses.get(ana)!.name === "mezcla", "an AI group is undone together");

  // someone else changed it since: no undo
  must(s, "resource.set", { key: mat, price: 2 });
  s.who = person("Other", "u-other");
  must(s, "resource.set", { key: mat, loss: 5 });
  s.who = person();
  assert.ok(fails(s, "undo") && p.prices.resources.get(mat)!.price === 2, "an undo that would erase someone else's work is refused");

  // the log is saved with the file
  assert.equal(reload(p).changes.length, p.changes.length, "the log after load");
  c = must(s, "log", { limit: 3 });
  assert.ok(c.changes.length === 3 && c.changes[0].who !== "", "log lists the last changes");
  assert.ok(fails(s, "nonsense"), "an unknown command");
  assert.ok(Object.keys(help()).length >= 25, "help lists the commands");
  assert.ok(fails(session(null), "info"), "no project: an error");
});

test("a failed command puts back what it touched", () => {
  const s = session();
  const p = s.project!;
  s.extra = {
    "test.half": (x) => {
      x.start("test.half", {}, "half");
      x.touch("project");
      p.name = "changed";
      return { error: "it failed halfway" };
    },
  };
  must(s, "project.set", { name: "before" });
  assert.ok(fails(s, "test.half"));
  assert.ok(p.name === "before" && p.changes.length === 1, "nothing changed, nothing logged");
});

test("the budget", () => {
  const s = session();
  const p = s.project!;
  setFields(p, { overheadPct: 10, profitPct: 0, taxesPct: 0 });
  must(s, "rubro.set", { number: 1, name: "MOVIMIENTO DE SUELOS" });
  must(s, "rubro.set", { number: 4, name: "MAMPOSTERIAS" });
  must(s, "resource.add", { kind: "material", name: "ladrillo", unit: "u", price: 2 });
  must(s, "analysis.add", { code: "50", name: "muro 0.15", unit: "m2", rubro: 4, lines: [{ resource: "MAT-0001", qty: 60 }] });
  must(s, "analysis.add", { code: "1", name: "excavacion", unit: "m3", rubro: 1, lines: [{ resource: "MAT-0001", qty: 5 }] });
  const h = () => s.project!.budget;
  const item = (id: string) => B.findItem(h(), id)!;

  let c = must(s, "item.add", { analysis: "50", qty: 100 });
  const a = c.id;
  assert.equal(c.code, "4.01", "an item from an analysis code, in its rubro");
  c = must(s, "item.add", { analysis: "1", qty: 10 });
  const b = c.id;
  assert.ok(c.code === "1.01" && h().items[0].id === b, "items are ordered by rubro");
  c = must(s, "item.add", { description: "Limpieza de obra", unit: "gl", unitCost: 500, qty: 1, rubro: 4 });
  const m = c.id;
  assert.equal(c.code, "4.02", "a manual item");
  assert.ok(fails(s, "item.add", { qty: 1 }), "an item needs an analysis or a description");

  // 100 m2 x 120 = 12000 direct; x 1.10 = 13200
  assert.ok(near(B.itemTotal(p, item(a)), 13200, 1e-6), "item total with the project's coefficients");
  must(s, "rubro.coefs", { rubro: 4, coefs: [{ name: "dificultad de acceso", pct: 5 }] });
  assert.ok(near(B.itemTotal(p, item(a)), 13860, 1e-6), "a rubro coefficient");
  must(s, "item.set", { key: "4.01", coefs: [{ name: "altura", pct: 10 }] });
  assert.ok(near(B.itemTotal(p, item(a)), 15246, 1e-6), "an item coefficient on top");
  assert.ok(near(B.itemTotal(p, item(b)), 110, 1e-6), "other rubros don't take it");
  c = must(s, "budget.list");
  assert.ok(c.items.length === 3 && c.rubros.length === 2 && near(c.price, 15246 + 110 + 500 * 1.1 * 1.05, 1e-6), "budget.list totals");

  must(s, "resource.set", { key: "MAT-0001", price: 3 });
  assert.ok(near(B.unitDirect(p, item(a)), 180), "a new resource price reaches the budget");

  assert.equal(must(s, "item.move", { key: m, by: -1 }).code, "4.01", "move up within the rubro");
  assert.ok(fails(s, "item.move", { key: m, by: -1 }), "not out of its rubro");
  must(s, "item.set", { key: m, rubro: 1 });
  assert.ok(item(m).code === "1.02" && item(a).code === "4.01", "a new rubro renumbers");

  must(s, "item.set", { key: b, qtySource: "design", designQty: 10, designRef: "excavation" });
  assert.ok(!B.overridden(item(b)), "the design's quantity");
  must(s, "item.set", { key: b, qty: 12 });
  assert.ok(B.overridden(item(b)) && B.itemProblem(p, item(b)).includes("by hand"), "changed by hand: marked");

  must(s, "undo");
  assert.equal(item(b).qty, 10, "undo the budget");
  must(s, "item.delete", { key: m });
  assert.equal(h().items.length, 2, "delete an item");
  const q = reload(s.project!);
  assert.ok(q.budget.items.length === 2 && B.findItem(q.budget, "4.01")!.coefs.length === 1 && B.coefsOf(q.budget, 4).length === 1, "the budget after load");
  assert.ok(near(B.itemTotal(q, B.findItem(q.budget, "4.01")!), 100 * 180 * 1.1 * 1.05 * 1.1, 1e-6), "the same total after load");
});

test("the Gantt", () => {
  const s = session();
  const p = s.project!;
  setFields(p, { startDate: "2026-11-16", workDaysPerWeek: 5, hoursPerDay: 8 }); // a Monday
  must(s, "resource.add", { kind: "labor", name: "ayudante", unit: "h", price: 3 });
  must(s, "analysis.add", { code: "1", name: "excavacion", unit: "m3", rubro: 1, lines: [{ resource: "MO-0001", qty: 2 }] });
  must(s, "analysis.add", { code: "2", name: "muro", unit: "m2", rubro: 4, lines: [{ resource: "MO-0001", qty: 1 }] });
  const e = must(s, "item.add", { analysis: "1", qty: 40 }).id;
  const m = must(s, "item.add", { analysis: "2", qty: 100 }).id;
  const f = must(s, "item.add", { description: "obrador", unitCost: 1000, qty: 1, rubro: 1 }).id;
  const task = (id: string) => s.project!.schedule.tasks.get(id)!;

  // 40 m3 x 2 h / (2 people x 8 h) = 5 days
  assert.equal(must(s, "task.set", { key: "1.01", suggest: true, crew: 2 }).days, 5, "days suggested from the labor hours");
  must(s, "task.set", { key: "4.01", days: 10, after: ["1.01"] });
  must(s, "task.set", { key: f, days: 3 });
  assert.ok(fails(s, "task.set", { key: "1.01", after: ["4.01"] }), "a loop is refused");
  assert.ok(fails(s, "task.set", { key: "1.01", days: -1 }), "negative days are refused");

  const c = must(s, "schedule.get", { curve: true });
  assert.equal(c.length, 15, "the length is the critical path");
  assert.ok(task(m).earlyStart === 5 && S.critical(task(e)) && S.critical(task(m)) && !S.critical(task(f)), "early start and the critical path");
  assert.equal(S.slack(task(f)), 12, "slack");
  assert.ok(S.dateOf(p, 5) === "2026-11-23" && c.end === "2026-12-04", "dates on working days");
  const spent = c.curve.reduce((t: number, v: [string, number, number]) => t + v[1], 0);
  assert.ok(c.curve.length === 2 && near(spent, B.totals(p)[1], 1e-6), "the investment curve spends the whole budget by month");
  // all at once: 100 m2 x 1 h / (4 x 8) = 3.125 -> 4 days; the obrador has no labor and keeps its 3
  assert.equal(must(s, "schedule.suggest", { crew: 4 }).changed, 2, "schedule.suggest");
  assert.ok(task(m).days === 4 && task(e).days === 3 && task(f).days === 3, "suggested days: " + [task(e).days, task(m).days, task(f).days]);
  must(s, "undo");
  assert.equal(task(m).days, 10, "undone at once");
  must(s, "task.set", { key: "4.01", lag: 2 });
  must(s, "schedule.get");
  assert.equal(task(m).earlyStart, 7, "a lag");
  must(s, "undo");
  S.compute(s.project!);
  assert.equal(task(m).earlyStart, 5, "undo a task change");

  must(s, "item.delete", { key: e });
  S.compute(s.project!);
  assert.ok(!s.project!.schedule.tasks.has(e) && task(m).after.length === 0 && task(m).earlyStart === 0, "a deleted item leaves the Gantt");
  assert.equal(reload(s.project!).schedule.tasks.get(m)!.days, 10, "the Gantt after load");
});

test("contracts, certificates, payments, the company", () => {
  const s = session();
  const p = s.project!;
  const co = s.company;
  let saved = 0;
  s.changed = (what) => {
    if (what === "company") saved++;
  };
  must(s, "resource.add", { kind: "material", name: "ladrillo", unit: "u", price: 2 });
  must(s, "analysis.add", { code: "50", name: "muro", unit: "m2", rubro: 4, lines: [{ resource: "MAT-0001", qty: 60 }] });
  must(s, "item.add", { analysis: "50", qty: 100 });

  let c = must(s, "contractor.add", { name: "Juan Pérez", trade: "albañilería", taxId: "20-1-3", docs: [{ kind: "ART", number: "1", expires: addDays(todayDay(), 5) }, { kind: "seguro", expires: "2099-01-01" }] });
  const juan = c.id;
  assert.equal(co.contractors.size, 1, "a contractor of the company");
  assert.equal(must(s, "contractor.get", { key: "juan pérez" }).contractor.docsDue.length, 1, "the documents about to expire");
  assert.ok(co.changes.length === 1 && co.changes[0].command === "contractor.add" && p.changes.length === 3, "the company's changes go to the company's log");
  assert.equal(saved, 1, "the company's data is saved at once");
  must(s, "contractor.add", { name: "Pedro Gómez", trade: "albañilería" });
  assert.ok(fails(s, "contractor.add", { name: "juan pérez" }), "no two contractors with one name");

  setFields(p, { advancePct: 10, retentionPct: 5 });
  c = must(s, "contract.add", { contractor: "Juan Pérez", baseIndex: 100, indexName: "CAC" });
  assert.equal(c.code, "C-01");
  const t = () => K.findContract(s.project!.contracts, "C-01")!;
  assert.ok(t().advancePct === 10 && t().retentionPct === 5 && t().title === "albañilería", "the contract takes the project's conditions");
  must(s, "part.add", { contract: "C-01", item: "4.01", pct: 60 });
  assert.equal(t().parts[0].qty, 60, "a part: 60% of an item");
  must(s, "part.set", { contract: "C-01", part: "4.01", unitPrice: 100 });
  must(s, "contract.add", { contractor: "Pedro Gómez" });
  must(s, "part.add", { contract: "C-02", item: "4.01" });
  assert.equal(K.findContract(p.contracts, "C-02")!.parts[0].qty, 40, "the other contractor takes what is left of the item");
  assert.ok(fails(s, "part.add", { contract: "C-02", item: "4.01" }), "nothing is left of it");
  assert.ok(near(K.amount(t()), 6000), "the contract's amount");

  must(s, "cert.add", { contract: "C-01", kind: "advance" });
  assert.ok(near(K.numbers(t(), t().certificates[0])[4], 600), "the advance certificate: 10%");
  assert.ok(fails(s, "cert.add", { contract: "C-01", kind: "advance" }), "only one advance");
  must(s, "cert.add", { contract: "C-01", period: "2026-12", index: 110 });
  must(s, "cert.set", { contract: "C-01", cert: 2, measures: [{ part: "4.01", acc: 30 }] });
  // work 30 x 100 = 3000; index 110/100: +300; advance 10%: -300; retention 5% of 3300: -165
  let f = K.numbers(t(), t().certificates[1]);
  assert.ok(near(f[0], 3000) && near(f[1], 300) && near(f[2], 300) && near(f[3], 165) && near(f[4], 2835), "certificate 2: " + f);
  must(s, "cert.set", { contract: "C-01", cert: 2, status: "issued" });
  assert.ok(fails(s, "cert.set", { contract: "C-01", cert: 2, measures: [{ part: "4.01", acc: 31 }] }), "an issued certificate keeps its measures");
  must(s, "cert.add", { contract: "C-01", period: "2027-01", index: 120 });
  assert.equal(t().certificates[2].measures[t().parts[0].id], 30, "a new certificate starts where the last one ended");
  assert.ok(fails(s, "cert.set", { contract: "C-01", cert: 3, measures: [{ part: "4.01", acc: 20 }] }), "the accumulated can't go back");
  assert.ok(fails(s, "cert.set", { contract: "C-01", cert: 3, measures: [{ part: "4.01", acc: 61 }] }), "not more than the contract");
  must(s, "cert.set", { contract: "C-01", cert: 3, measures: [{ part: "4.01", pct: 100 }], status: "issued" });
  f = K.numbers(t(), t().certificates[2]);
  assert.ok(near(f[0], 3000) && near(f[1], 600) && near(f[4], 3120), "certificate 3 by %: " + f);
  must(s, "cert.add", { contract: "C-01", kind: "retention" });
  assert.ok(near(K.numbers(t(), t().certificates[3])[4], 345), "the retention given back: 165 + 180");
  assert.ok(near(K.progress(t()), 1) && K.itemMeasured(p.contracts, p.budget.items[0].id) === 60, "progress of the contract and of the item");
  assert.ok(near(S.doneOf(p, p.budget.items[0]), 0.6), "the Gantt's progress comes from the certificates");

  must(s, "cert.set", { contract: "C-01", cert: 1, status: "issued" });
  must(s, "payment.add", { contract: "C-01", amount: 600, certificate: 1, means: "transfer", invoice: "A-0001-1" });
  const bal = K.balance(t());
  assert.ok(near(bal[0], 600 + 2835 + 3120) && near(bal[1], 600) && near(bal[2], 5955), "balance: " + bal);
  assert.equal(t().payments[0].certificate, t().certificates[0].id, "the payment points to its certificate");
  assert.ok(fails(s, "contractor.delete", { key: juan }), "a contractor with contracts can't be deleted");
  const other = { ...session(newProject("p-other"), s.company), projects: () => [newProject("p-x"), p] };
  assert.match(String(run(other, "contractor.delete", { key: juan }).error), /C-01 of/, "nor when the contract is in another project");
  assert.ok(fails(s, "part.remove", { contract: "C-01", part: "4.01" }), "a part with certified work can't be removed");

  // undo: the newest of the project's log and the company's
  must(s, "contractor.set", { key: juan, phone: "123" });
  must(s, "undo");
  assert.ok(co.contractors.get(juan)!.phone === "" && t().payments.length === 1, "undo takes the company's change when it is the newest");
  must(s, "undo");
  assert.equal(t().payments.length, 0, "then the project's");

  // the file, and the company's data read again
  const q = reload(s.project!);
  const c1 = K.findContract(q.contracts, "C-01")!;
  assert.ok(q.contracts.length === 2 && near(K.numbers(c1, c1.certificates[2])[4], 3120), "the contracts after load");
  const co2 = Co.companyFromFiles(JSON.parse(JSON.stringify(Co.companyToFiles(co))));
  assert.ok(co2.contractors.size === 2 && co2.contractors.get(juan)!.docs.length === 2 && co2.changes.length >= 4, "the company's data after reading it again");

  // the standard library: export, and a new project starts with it
  must(s, "standard.export");
  assert.equal(co.standard!.resources.size, 1, "export the prices to the standard library");
  const n = startProject(co.standard);
  assert.ok(n.prices.resources.size === 1 && n.prices.analyses.size === 1, "a new project starts with the standard library");
  const s2 = session(n, co);
  must(s2, "resource.set", { key: "MAT-0001", price: 9 });
  must(s2, "prices.fromStandard");
  assert.equal(P.resourceByCode(n.prices, "MAT-0001")!.price, 2, "the standard's prices taken again");
});

test("a project file written by the Gambas version", async () => {
  // made by the Gambas smoke test: SMOKE_KEEP_DIR=web/test/gambas gbx3 . -- --smoke-test
  const fs = await import("node:fs");
  const dir = new URL("../../test/gambas/", import.meta.url);
  const file = JSON.parse(fs.readFileSync(new URL("contracts.contract-proj", dir), "utf8"));
  assert.equal(file.format, "sumi-contract");
  const p = projectFromJson(file.project, "p-gambas");
  // everything comes back the same (Gambas writes an empty text as null)
  const same = (a: unknown, b: unknown): boolean => {
    if ((a === null || a === "") && (b === null || b === "")) return true;
    if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return a === b;
    const k = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...k].every((x) => same((a as any)[x], (b as any)[x]));
  };
  assert.ok(same(file.project, JSON.parse(JSON.stringify(projectToJson(p)))), "the same JSON after a round trip");
  const t = K.findContract(p.contracts, "C-01")!;
  assert.ok(near(K.numbers(t, t.certificates[2])[4], 3120), "the same certificate amounts");
  // its change log works here: undo the last change Gambas logged (the payment was undone there; redo it here)
  const co = Co.companyFromFiles({ "contractors.json": JSON.parse(fs.readFileSync(new URL("contractors.json", dir), "utf8")), "log.json": JSON.parse(fs.readFileSync(new URL("log.json", dir), "utf8")) });
  const s = session(p, co);
  s.who = { ...person(), userId: p.changes[0].userId };
  assert.equal(t.payments.length, 0);
  must(s, "redo");
  assert.equal(K.findContract(s.project!.contracts, "C-01")!.payments.length, 1, "redo of an undo made by the Gambas version");
  assert.equal(must(s, "contract.list").contracts[0].contractor, "Juan Pérez", "the company's contractors from the Gambas files");
});

test("the licita2003 import", async () => {
  const { importLibrary, parseCsv } = await import("../src/model/library.ts");
  const a = parseCsv('a,b,c\r\n1,"x, ""y""",3\n\n4,5');
  assert.ok(a.length === 4 && a[1][1] === 'x, "y"' && a[3][0] === "4" && a[3][1] === "5", "csv: rows, quoted fields, no newline at the end");

  const files = {
    "rubros.csv": "number,name\n1,MOVIMIENTO DE SUELOS\n",
    "resources.csv": 'code,name,unit,price,origin,loss,kind\n2001,"cemento, portland",t,254.0,Corrientes,,material\n90009,ayudante,h,2.79,Corrientes,,labor\n90010,mo electrica,h,3.75,Corrientes,,labor\n',
    "analyses.csv": "code,rubro,name,unit,equipment_yield,labor_yield\n1,1,Excavacion,m3,1,1\n",
    "analysis-items.csv": "analysis,resource,quantity\n1,90009,3.4\n1,7777,1\n9,2001,1\n",
    "labor.csv": "code,category,wage_per_hour\n90009,Ayudante,1.14\n90010,Sereno,1.04\n",
  };
  const added = { "resources.csv": "code,name,unit,price,origin,loss,kind\n7777,bañadera,u,,,,material\n" };
  let b = P.newBook();
  let r = importLibrary(b, files, "base", added);
  assert.ok(!r.error, "import a library");
  assert.ok(b.resources.size === 4 && b.analyses.size === 1 && b.rubros.size === 1, "imported counts");
  assert.equal(P.resourceByCode(b, "2001")!.name, "cemento, portland", "a quoted name");
  assert.equal(P.analysisByCode(b, "1")!.lines.length, 2, "analysis lines (one of an analysis that doesn't exist skipped)");
  const ayu = P.resourceByCode(b, "90009")!;
  assert.ok(ayu.override && P.priceOf(b, ayu) === 2.79 && ayu.wage === 1.14, "labor keeps its typed price as an override, with its wage");
  assert.equal(P.resourceByCode(b, "90010")!.name, "Sereno", "the mdo name wins (90010 is Sereno)");
  const tub = P.resourceByCode(b, "7777")!;
  assert.ok(tub.name === "bañadera" && P.priceOf(b, tub) === 0, "the added files fill a missing resource, without price");
  assert.ok(r.report.join("\n").includes("overrides"), "the report lists the overrides");
  assert.ok(r.report.join("\n").includes("have no price"), "the report says what has no price");
  importLibrary(b, files, "base", added);
  assert.ok(b.resources.size === 4 && b.analyses.size === 1 && P.analysisByCode(b, "1")!.lines.length === 2, "importing again updates");
  assert.ok(importLibrary(P.newBook(), {}, "nothing").error, "nothing to read is refused");

  // the real library, shipped with the program
  const fs = await import("node:fs");
  const read = (dir: string) => Object.fromEntries(fs.readdirSync(new URL(dir, import.meta.url)).map((f) => [f, fs.readFileSync(new URL(dir + f, import.meta.url), "utf8")]));
  b = P.newBook();
  r = importLibrary(b, read("../../library/licita2003/"), "licita2003", read("../../library/added/"));
  assert.ok(!r.error && b.analyses.size >= 467 && b.resources.size >= 395, `licita2003: ${b.analyses.size} analyses, ${b.resources.size} resources`);
  // licita2003 analysis 1: Excavacion para sanjas continuas a mano = 3.4 h of ayudante 90009 (typed 2.79)
  assert.ok(near(P.direct(b, P.analysisByCode(b, "1")!), 3.4 * 2.79), "licita2003 analysis 1 costs 3.4 h of ayudante at 2.79");
  assert.equal(P.resourceByCode(b, "90010")!.name, "Sereno", "licita2003: 90010 is Sereno");

  // the command: logged, undone at once
  const s = session();
  s.library = (name) => (name === "licita2003" ? { files: read("../../library/licita2003/"), added: read("../../library/added/") } : undefined);
  const c = must(s, "prices.import", { library: "licita2003" });
  assert.ok(c.report.length > 3 && s.project!.prices.analyses.size >= 467, "prices.import");
  assert.ok(fails(s, "prices.import", { library: "nothing" }), "an unknown library");
  assert.ok(fails(s, "prices.import", { files: { "x.csv": "" } }) && s.project!.prices.analyses.size >= 467, "files that aren't a library change nothing");
  assert.ok(!("files" in s.project!.changes[0].args), "the files' texts are not kept in the log");
  must(s, "undo");
  assert.equal(s.project!.prices.analyses.size, 0, "undo the import");
});

test("the PDF reports", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { makeReport, REPORT_KINDS } = await import("../src/model/reports.ts");
  const { PdfDoc } = await import("../src/model/pdf.ts");
  const dir = new URL("../../test/gambas/", import.meta.url);
  const p = projectFromJson(JSON.parse(fs.readFileSync(new URL("contracts.contract-proj", dir), "utf8")).project, "p-pdf");
  const co = Co.companyFromFiles({ "contractors.json": JSON.parse(fs.readFileSync(new URL("contractors.json", dir), "utf8")) });
  co.info.name = "Constructora Sur SA";
  co.info.taxId = "30-12345678-9";
  const pdf = new PdfDoc();
  assert.ok(pdf.textWidth("W", 10) > pdf.textWidth("i", 10) && pdf.fit("a long text that doesn't fit", 10, 9).endsWith("..."), "text widths and cutting");
  // pdfinfo and pdftotext read them, when the computer has them (poppler-utils); SMOKE_PDF_DIR keeps them
  const has = (() => {
    try {
      execFileSync("pdfinfo", ["-v"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  const out = process.env.SMOKE_PDF_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "sumi-pdf-"));
  for (const kind of REPORT_KINDS) {
    const r = makeReport(p, co, kind, "C-01", kind === "certificate" ? "3" : "");
    assert.ok(r.pdf && !r.error, `the ${kind} report: ${r.error ?? ""}`);
    const head = String.fromCharCode(...r.pdf.slice(0, 8));
    assert.ok(head.startsWith("%PDF-1.4") && r.pages! >= 1, `${kind}: a PDF`);
    if (!has) continue;
    const file = path.join(out, kind + ".pdf");
    fs.writeFileSync(file, r.pdf);
    const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    assert.match(info, new RegExp(`Pages:\\s+${r.pages}\\b`), `${kind}: pdfinfo reads it`);
    const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    assert.ok(text.includes(p.name) && text.includes(`1 of ${r.pages}`) && text.includes("Constructora Sur SA · CUIT 30-12345678-9"), `${kind}: its header and footer, with the company`);
    if (kind === "certificate") assert.ok(text.includes("Juan Pérez") && text.includes("3,120.00"), "the certificate: the contractor (an accent) and the net");
  }
  assert.ok(makeReport(p, co, "certificate", "C-01", "99").error && makeReport(p, co, "nothing").error && makeReport(newProject(), co, "budget").error, "what can't be made says why");
  if (!process.env.SMOKE_PDF_DIR) fs.rmSync(out, { recursive: true });
});

test("the design link (sumi-designer's quantities)", () => {
  const s = session();
  const p = s.project!;
  must(s, "project.set", { overheadPct: 0, profitPct: 0, taxesPct: 0 });
  must(s, "resource.add", { kind: "material", name: "ladrillo", unit: "u", price: 1 });
  must(s, "analysis.add", { code: "52", name: "muro", unit: "m2", rubro: 4, lines: [{ resource: "MAT-0001", qty: 60 }] });
  must(s, "analysis.add", { code: "79", name: "revoque", unit: "m2", rubro: 7, lines: [{ resource: "MAT-0001", qty: 2 }] });
  const row1 = (q: number) => ({ key: "Walls|Solid brick 18", group: "Muros", item: "Ladrillo macizo 18", unit: "m2", qty: q });
  const row2 = (q: number) => ({ key: "Walls|Plaster", group: "Muros", item: "Revoque", unit: "m2", qty: q });
  const row3 = { key: "Openings|V1", group: "Aberturas", item: "V1", unit: "u", qty: 4 };
  const file = (date: string, rows: unknown[], map: unknown) => JSON.stringify({ format: "designer-e", version: 42, quantities: { date, rows }, analyses: map });
  const load = (text: string) => run(s, "design.load", { name: "house.designer-proj", text });

  assert.ok(fails(s, "design.sync"), "no design yet: an error");
  assert.match(String(load(JSON.stringify({ format: "designer-e", version: 41 })).error), /version 42/, "an older designer file: it says to save it again");
  assert.ok(load(file("2026-11-17 20:00:00", [row1(100), row2(80), row3], { "Walls|Solid brick 18": [{ code: "52", factor: 1 }] })).ok);
  assert.ok(!("text" in p.changes[p.changes.length - 1].args), "the file's text isn't kept in the log");
  let c = must(s, "design.rows");
  assert.ok(c.rows.length === 3 && c.rows[0].fromDesigner && c.rows[1].analyses.length === 0, "design.rows");
  must(s, "design.map", { key: "Walls|Plaster", analyses: [{ code: "79", factor: 2 }] });
  c = must(s, "design.sync");
  const h = p.budget;
  assert.equal(h.items.length, 2, "items from the design: " + c.report.join(" | "));
  assert.ok(h.items[0].code === "4.01" && h.items[0].qty === 100 && h.items[0].qtySource === "design", "the brick: 100 m2 from the design");
  assert.ok(h.items[1].code === "7.01" && h.items[1].qty === 160 && h.items[1].designQty === 160, "the plaster: 80 m2 × 2 (both faces)");
  assert.ok(c.report.join("\n").includes("V1"), "the report lists the rows without analyses");

  // the design changes: items follow, unless changed by hand; a row that is gone is said
  must(s, "item.set", { key: "7.01", qty: 150 });
  load(file("2026-11-18 09:00:00", [row1(120)], { "Walls|Solid brick 18": [{ code: "52", factor: 1 }] }));
  c = must(s, "design.sync");
  assert.ok(p.budget.items[0].qty === 120 && p.budget.items.length === 2, "a design quantity follows the design");
  assert.ok(p.budget.items[1].qty === 150 && p.budget.items[1].designQty === 0 && B.overridden(p.budget.items[1]), "a hand change is kept, and the row that is gone is marked");
  assert.ok(c.report.join("\n").includes("doesn't have anymore"), "the report says what is gone");
  // the designer's map wins over the project's
  load(file("x", [row2(10)], { "Walls|Plaster": [{ code: "79", factor: 1 }] }));
  must(s, "design.sync");
  assert.equal(s.project!.budget.items[1].designQty, 10, "the designer's map wins");
  must(s, "undo");
  assert.equal(s.project!.budget.items[1].designQty, 0, "undo a sync");
  must(s, "undo");
  assert.equal(s.project!.design!.date, "2026-11-18 09:00:00", "undo a load");
  assert.equal(reload(s.project!).design!.rows.length, 1, "the design's quantities are in the file");
});
