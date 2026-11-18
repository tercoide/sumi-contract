// One entry of a change log: who changed what, when, how, and the values before and after. The log only
// grows: an undo is a new entry that puts the before back (undoOf). Entries of one action (an AI turn, an
// import) share a group, and are undone together. (Port of Change and Who.)

import { makeId } from "./ids.ts";
import { isObj, nowStamp, str } from "./text.ts";

export const PERSON = "person";
export const AI = "ai";
export const IMPORT = "import";
export const SYSTEM = "system";

/** Who is making the changes: a person, the AI working for that person (with its model), an import, the program */
export interface Who {
  name: string;
  userId: string;
  via: string; // PERSON, AI, IMPORT or SYSTEM
  model: string; // the AI model, when via = AI
}

export interface Change {
  id: string;
  when: string; // yyyy-mm-dd hh:nn:ss
  who: string;
  userId: string;
  via: string;
  model: string;
  command: string;
  args: Record<string, unknown>;
  summary: string; // in words, for people
  group: string; // the action it belongs to
  targets: string[]; // what it touched: "resource:<id>", "analysis:<id>", "project"...
  before: Record<string, unknown>; // the targets before (target -> JSON, ABSENT = didn't exist)
  after: Record<string, unknown>; // and after (not kept for whole price books: too big)
  undoOf: string; // this entry undoes (or redoes) that one
  undoneBy: string; // the entry that undid this one
}

export function newChange(who: Who, command: string, args: Record<string, unknown>, summary: string, group = ""): Change {
  return { id: makeId("c"), when: nowStamp(), who: who.name, userId: who.userId, via: who.via, model: who.model, command, args, summary, group, targets: [], before: {}, after: {}, undoOf: "", undoneBy: "" };
}

export function changeToJson(h: Change): Record<string, unknown> {
  const c: Record<string, unknown> = { id: h.id, when: h.when, who: h.who, userId: h.userId, via: h.via };
  if (h.model) c.model = h.model;
  c.command = h.command;
  c.args = h.args;
  c.summary = h.summary;
  if (h.group) c.group = h.group;
  c.targets = h.targets;
  c.before = h.before;
  if (Object.keys(h.after).length) c.after = h.after;
  if (h.undoOf) c.undoOf = h.undoOf;
  if (h.undoneBy) c.undoneBy = h.undoneBy;
  return c;
}

export function changeFromJson(c: unknown): Change {
  const o = isObj(c) ? c : {};
  return {
    id: str(o.id) || makeId("c"),
    when: str(o.when),
    who: str(o.who),
    userId: str(o.userId),
    via: str(o.via),
    model: str(o.model),
    command: str(o.command),
    args: isObj(o.args) ? o.args : {},
    summary: str(o.summary),
    group: str(o.group),
    targets: Array.isArray(o.targets) ? o.targets.map(str) : [],
    before: isObj(o.before) ? o.before : {},
    after: isObj(o.after) ? o.after : {},
    undoOf: str(o.undoOf),
    undoneBy: str(o.undoneBy),
  };
}
