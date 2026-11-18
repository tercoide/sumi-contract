// The Gantt: a task for each budget item (one task per item), scheduled by the critical path method on
// working days from the project's start, and the investment curve (the price spent each month, spread over
// each task's working days). Days are working days counted from the start (day 0 = the first working day).
// (Port of Schedule and GanttTask; the JSON is the Gambas file's.)

import { indexOfItem, itemTotal, type BudgetItem } from "./budget.ts";
import { itemMeasured } from "./contracts.ts";
import { addDays } from "./dates.ts";
import { LABOR, MAX_DEPTH, type Analysis } from "./prices.ts";
import { isWorkDay, type Project } from "./project.ts";
import { BadValue, int, isObj, num, str, tr } from "./text.ts";

export interface GanttTask {
  item: string; // the budget item's id (the task's id too)
  days: number; // working days it takes (0 = a milestone)
  crew: number; // people working on it (0 = not set): for the suggestion
  after: string[]; // items it waits for (finish to start)
  lag: number; // working days to wait after them (negative = overlap)
  startNotBefore: number; // it can't start before this working day
  done: number; // progress, 0 to 1
  // worked out by compute
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
}

export interface Schedule {
  tasks: Map<string, GanttTask>; // by item id
  problem: string; // why the last compute couldn't finish (a loop), or ""
  length: number; // working days of the whole work (after compute)
}

export function newSchedule(): Schedule {
  return { tasks: new Map(), problem: "", length: 0 };
}

export function newTask(item: string): GanttTask {
  return { item, days: 1, crew: 0, after: [], lag: 0, startNotBefore: 0, done: 0, earlyStart: 0, earlyFinish: 0, lateStart: 0, lateFinish: 0 };
}

export const slack = (t: GanttTask) => t.lateStart - t.earlyStart;
export const critical = (t: GanttTask) => slack(t) < 1e-6;

export function taskToJson(t: GanttTask): Record<string, unknown> {
  const c: Record<string, unknown> = { item: t.item, days: t.days };
  if (t.crew) c.crew = t.crew;
  if (t.after.length) c.after = [...t.after];
  if (t.lag) c.lag = t.lag;
  if (t.startNotBefore) c.startNotBefore = t.startNotBefore;
  if (t.done) c.done = t.done;
  return c;
}

/** Sets the fields present in c; a field it doesn't know or can't take, or "" */
export function applyTask(t: GanttTask, c: Record<string, unknown>): string {
  for (const [key, v] of Object.entries(c)) {
    try {
      switch (key) {
        case "item":
        case "key":
          break;
        case "days":
          if (num(v, key) < 0) return key;
          t.days = num(v, key);
          break;
        case "crew":
          t.crew = num(v, key);
          break;
        case "after":
          if (!Array.isArray(v)) return key;
          t.after = v.map(str);
          break;
        case "lag":
          t.lag = int(v, key);
          break;
        case "startNotBefore":
          t.startNotBefore = int(v, key);
          break;
        case "done":
          if (num(v, key) < 0 || num(v, key) > 1) return key;
          t.done = num(v, key);
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

export function scheduleToJson(s: Schedule): Record<string, unknown> {
  return { tasks: [...s.tasks.values()].map(taskToJson) };
}

export function scheduleFromJson(c: unknown): Schedule {
  const s = newSchedule();
  if (!isObj(c) || !Array.isArray(c.tasks)) return s;
  for (const v of c.tasks) {
    if (!isObj(v)) continue;
    const t = newTask(str(v.item));
    applyTask(t, v);
    s.tasks.set(t.item, t);
  }
  return s;
}

/** The task of an item, made if it has none */
export function taskOf(s: Schedule, item: string): GanttTask {
  let t = s.tasks.get(item);
  if (!t) {
    t = newTask(item);
    s.tasks.set(item, t);
  }
  return t;
}

/** Makes the missing tasks (days from the labor hours with a crew of 2) and drops those of items that are gone */
export function sync(p: Project): void {
  const s = p.schedule;
  for (const b of p.budget.items) if (!s.tasks.has(b.id)) taskOf(s, b.id).days = Math.max(1, Math.ceil(suggestDays(p, b, 2) - 1e-9));
  const gone = [...s.tasks.keys()].filter((id) => indexOfItem(p.budget, id) < 0);
  for (const id of gone) s.tasks.delete(id);
  if (gone.length) for (const t of s.tasks.values()) t.after = t.after.filter((id) => !gone.includes(id));
}

/** How much of an item is done (0 to 1): what the certificates measured, or the task's done if no contract takes it */
export function doneOf(p: Project, b: BudgetItem): number {
  const f = itemMeasured(p.contracts, b.id);
  if (f >= 0) return b.qty <= 0 ? 0 : Math.min(1, f / b.qty);
  return p.schedule.tasks.get(b.id)?.done ?? 0;
}

/** A rubro condensed: [first start, last end, progress weighted by the items' totals] */
export function rubroSpan(p: Project, rubro: number): [number, number, number] {
  let start = 1e12;
  let end = 0;
  let done = 0;
  let all = 0;
  for (const b of p.budget.items) {
    if (b.rubro !== rubro) continue;
    const t = p.schedule.tasks.get(b.id);
    if (!t) continue;
    start = Math.min(start, t.earlyStart);
    end = Math.max(end, t.earlyFinish);
    const total = itemTotal(p, b);
    all += total;
    done += total * doneOf(p, b);
  }
  if (start > end) start = 0;
  if (all > 0) done /= all;
  return [start, end, done];
}

/** Labor hours of one unit of an item (its analysis's labor lines in hours, sub-analyses included, over its labor yield) */
export function laborHours(p: Project, b: BudgetItem): number {
  const a = b.analysis ? p.prices.analyses.get(b.analysis) : undefined;
  return a ? hoursOf(p, a, 0) : 0;
}

function hoursOf(p: Project, a: Analysis, depth: number): number {
  if (depth > MAX_DEPTH) return 0;
  let f = 0;
  for (const l of a.lines) {
    if (l.isAnalysis) {
      const s = p.prices.analyses.get(l.ref);
      if (s) f += l.qty * hoursOf(p, s, depth + 1);
    } else {
      const r = p.prices.resources.get(l.ref);
      if (r && r.kind === LABOR && r.unit.toLowerCase().startsWith("h")) f += l.qty / (a.laborYield > 0 ? a.laborYield : 1);
    }
  }
  return f;
}

/** Working days an item takes with a crew: quantity × labor hours a unit / (crew × hours a day) */
export function suggestDays(p: Project, b: BudgetItem, crew: number): number {
  if (crew <= 0 || p.hoursPerDay <= 0) return 0;
  return (b.qty * laborHours(p, b)) / (crew * p.hoursPerDay);
}

/** The critical path: early start and finish forward, late ones backward. True if there is a loop. */
export function compute(p: Project): boolean {
  const s = p.schedule;
  s.problem = "";
  sync(p);
  const order = topoOrder(s);
  if (!order) {
    s.problem = tr("Some tasks wait for each other in a loop.");
    return true;
  }
  for (const id of order) {
    const t = s.tasks.get(id)!;
    let f = t.startNotBefore;
    for (const q of predecessors(s, t)) f = Math.max(f, q.earlyFinish + t.lag);
    t.earlyStart = Math.max(0, f);
    t.earlyFinish = t.earlyStart + t.days;
  }
  s.length = 0;
  for (const t of s.tasks.values()) s.length = Math.max(s.length, t.earlyFinish);
  for (const t of s.tasks.values()) t.lateFinish = s.length;
  for (const id of order.reverse()) {
    const t = s.tasks.get(id)!;
    t.lateStart = t.lateFinish - t.days;
    for (const q of predecessors(s, t)) q.lateFinish = Math.min(q.lateFinish, t.lateStart - t.lag);
  }
  return false;
}

function predecessors(s: Schedule, t: GanttTask): GanttTask[] {
  return t.after.map((id) => s.tasks.get(id)).filter((q): q is GanttTask => q !== undefined);
}

/** The tasks in an order where each comes after what it waits for; null if there is a loop */
function topoOrder(s: Schedule): string[] | null {
  const out: string[] = [];
  const state = new Map<string, number>();
  const visit = (t: GanttTask): boolean => {
    const st = state.get(t.item);
    if (st === 2) return false;
    if (st === 1) return true; // a loop
    state.set(t.item, 1);
    for (const q of predecessors(s, t)) if (visit(q)) return true;
    state.set(t.item, 2);
    out.push(t.item);
    return false;
  };
  for (const t of s.tasks.values()) if (visit(t)) return null;
  return out;
}

/** Would item waiting for other make a loop? */
export function makesLoop(s: Schedule, item: string, other: string): boolean {
  const seen = new Set<string>();
  const reaches = (from: string, to: string): boolean => {
    if (from === to) return true;
    if (seen.has(from) || !s.tasks.has(from)) return false;
    seen.add(from);
    return s.tasks.get(from)!.after.some((id) => reaches(id, to));
  };
  return reaches(other, item);
}

/** The date of a working day counted from the project's start (day 0 = the first working day) */
export function dateOf(p: Project, day: number): string {
  let d = p.startDate;
  let n = Math.trunc(day);
  if (p.workDaysPerWeek < 1) return d;
  while (!isWorkDay(p, d)) d = addDays(d, 1);
  while (n > 0) {
    d = addDays(d, 1);
    if (isWorkDay(p, d)) n--;
  }
  return d;
}

/** The investment curve: [month "yyyy-mm", price spent that month, accumulated] for each month of the work, each
 *  item's total spread evenly over its working days (early schedule). Compute first. */
export function curve(p: Project): [string, number, number][] {
  const s = p.schedule;
  const month = new Map<string, number>();
  // the month of each working day, once
  const days: string[] = [];
  if (p.workDaysPerWeek >= 1) {
    let d = dateOf(p, 0);
    for (let i = 0; i <= Math.ceil(s.length) + 1; i++) {
      days.push(d.slice(0, 7));
      do d = addDays(d, 1);
      while (!isWorkDay(p, d));
    }
  }
  for (const b of p.budget.items) {
    const t = s.tasks.get(b.id);
    if (!t) continue;
    const n = Math.max(1, Math.ceil(t.days));
    const daily = itemTotal(p, b) / n;
    for (let i = 0; i < n; i++) {
      const k = Math.trunc(t.earlyStart + i);
      const m = k < days.length ? days[k] : dateOf(p, t.earlyStart + i).slice(0, 7);
      month.set(m, (month.get(m) ?? 0) + daily);
    }
  }
  let acc = 0;
  return [...month.keys()].sort().map((m) => {
    acc += month.get(m)!;
    return [m, month.get(m)!, acc];
  });
}

