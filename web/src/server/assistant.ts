// The AI assistant: Claude working on an open project for the person who asks (decided with the user
// 2026-11-17: the AI should help with everything, from searching prices on the web to applying them). Port of
// the Gambas Assistant module.
//
// It has one tool, "sumi", which runs a command (model/cmd.ts, the same ones the screens use), so whatever it
// changes is logged as the AI with its model, for its person; everything one request changes is one group,
// which undo takes back at once. It may also search the web (prices, suppliers, norms). The conversation is
// kept per person and project, append-only (thinking and fallback blocks go back unchanged), until "new chat".
//
// The loop is the program's own (not the SDK's tool runner): a turn begins and ends the command group, can be
// stopped, and its requests go through a Sender, which the tests replace with canned replies.
//
// Settings: <data>/ai.json {model, effort, webSearch, apiKey} or SUMI_AI_MODEL, SUMI_AI_EFFORT,
// SUMI_AI_WEB_SEARCH (0 = no), ANTHROPIC_API_KEY.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaToolResultBlockParam, BetaToolUnion, MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AI } from "../model/change.ts";
import { beginGroup, endGroup, help, run, type Session } from "../model/cmd.ts";
import { isObj, tr } from "../model/text.ts";

export const MAX_TOKENS = 64000; // streamed, so no timeout to fear
export const MAX_ROUNDS = 40; // requests in one turn: a guard against loops
export const MAX_RESULT = 30000; // characters of a tool result sent back
const MAX_BAD_STREAMS = 2; // a stream cut or a tool input that can't be read: sent again this many times
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Models that take server-side fallbacks (if the model declines, the API goes on with another) */
const TAKE_FALLBACKS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1", "claude-opus-5"];
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export interface AIConfig {
  model: string;
  effort: (typeof EFFORTS)[number];
  webSearch: boolean;
  apiKey: string; // "" = the SDK finds it (ANTHROPIC_API_KEY...)
}

export function loadAIConfig(dataDir: string, env = process.env): AIConfig {
  let f: Record<string, unknown> = {};
  try {
    f = JSON.parse(fs.readFileSync(path.join(dataDir, "ai.json"), "utf8"));
  } catch {}
  const effort = String(env.SUMI_AI_EFFORT || f.effort || "high");
  const web = env.SUMI_AI_WEB_SEARCH ?? f.webSearch;
  return {
    model: String(env.SUMI_AI_MODEL || f.model || "claude-opus-5-5"),
    effort: (EFFORTS as readonly string[]).includes(effort) ? (effort as AIConfig["effort"]) : "high",
    webSearch: !(web === false || web === "0" || web === "false"),
    apiKey: String(f.apiKey || ""),
  };
}

/** Sends one request and returns the whole reply; onText gets the text as it comes. Throws the SDK's errors. */
export type Sender = (params: MessageCreateParamsBase, signal: AbortSignal, onText: (t: string) => void) => Promise<BetaMessage>;

/** The real one: the Messages API, streamed */
export function apiSender(c: AIConfig): Sender {
  const client = c.apiKey ? new Anthropic({ apiKey: c.apiKey }) : new Anthropic();
  return async (params, signal, onText) => {
    const stream = client.beta.messages.stream(params, { signal });
    stream.on("text", onText);
    return stream.finalMessage();
  };
}

/** Is there a key the program can see? (The SDK may still find a profile: this is for the warning.) */
export function hasKey(c: AIConfig, env = process.env): boolean {
  return !!(c.apiKey || env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
}

export const SYSTEM_PROMPT = [
  "You are the assistant inside sumi-contract, the paperwork program of the sumi suite for building works (GambasCAD and sumi-e draw, sumi-designer models the building, sumi-contract makes the budget, the schedule and the contracts). The users are an Argentine construction company's team; answer in the language they write in (usually Spanish), briefly.",
  "You work on the open project only through the tool `sumi`, which runs the program's commands. Everything you change is logged under your name and the person's, and they can undo your whole turn at once, so act: do what is asked without asking for confirmation, unless the request is unclear or would delete a lot. Look before you change (info, resource.list, analysis.get). When you are done, say in a few lines what you did and what is left.",
  "Prices: a resource's unit price is (typed price or its calculation + freight) × (1 + loss%) × the book's update coefficient. Labor prices come from the wage plus the labor charges unless `override` is true; equipment from its machine calculation (depreciation, interest, repairs, fuel, lubricants) unless `override`. An analysis (análisis de precios) costs A materials + B equipment / its equipment yield + C labor / its labor yield, sub-analyses included; the price is that direct cost × the project's coefficients (general expenses, profit, taxes). Codes are what people see; ids never change. Argentina has high inflation: prices go stale fast.",
  "When you search the web for a price: prefer recent sources from Argentina (suppliers, Revista Vivienda, Cámara Argentina de la Construcción, union wage tables UOCRA), convert to the resource's unit, and set `price`, `source` (the site and the URL) and `updated` (the date of the source, yyyy-mm-dd) together. Say when a price is an estimate. Never invent a source.",
  "PDF reports: report.pdf gives a url; give it to the person as a link, as it is.",
].join("\n\n");

/** What the person sees of the conversation */
export interface Entry {
  who: "you" | "ai";
  text: string;
  steps: string[];
  error?: string;
}

export type Event = { type: "text"; text: string } | { type: "step"; text: string; changed: boolean } | { type: "round"; n: number } | { type: "done"; entry: Entry };

const LOOKING = /(\.list|\.get)$|^(info|log|help)$/;

export class Chat {
  messages: BetaMessageParam[] = []; // the conversation, as the API takes it
  entries: Entry[] = [];
  busy = false;
  private abort: AbortController | null = null;
  private config: AIConfig;
  private send: Sender;

  constructor(config: AIConfig, send: Sender) {
    this.config = config;
    this.send = send;
  }

  /** The request, as it would go */
  params(): MessageCreateParamsBase {
    const tools: BetaToolUnion[] = [
      {
        name: "sumi",
        description:
          "Runs one command on the open sumi-contract project and returns its result as JSON ({ok: true, ...} or {error: why}). Use it for everything about the project: reading it and changing it. Commands that change the project are logged under your name and can be undone. Query first (info, resource.list, analysis.get...), then change. The commands and their arguments:\n" +
          JSON.stringify(help()),
        input_schema: {
          type: "object",
          properties: { command: { type: "string", description: "the command, e.g. resource.set" }, args: { type: "object", description: "its arguments" } },
          required: ["command"],
        },
        eager_input_streaming: true,
      },
    ];
    if (this.config.webSearch) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 20, user_location: { type: "approximate", country: "AR" } });
    const p: MessageCreateParamsBase = {
      model: this.config.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      thinking: { type: "adaptive" },
      output_config: { effort: this.config.effort },
      cache_control: { type: "ephemeral" },
      messages: this.messages,
    };
    if (TAKE_FALLBACKS.includes(this.config.model)) {
      p.betas = [FALLBACK_BETA];
      p.fallbacks = "default";
    }
    return p;
  }

  newChat(): boolean {
    if (this.busy) return false;
    this.messages = [];
    this.entries = [];
    return true;
  }

  stop(): void {
    this.abort?.abort();
  }

  /** A turn: the person's request, worked until Claude is done. s is the person's session on the project
   *  (its who becomes the AI's for the turn). emit gets what happens as it happens; resume is called after
   *  each wait for the API (the server sets the person's language again). */
  async ask(s: Session, prompt: string, emit: (e: Event) => void, resume: () => void = () => {}): Promise<Entry> {
    const entry: Entry = { who: "ai", text: "", steps: [] };
    if (this.busy) return { ...entry, error: tr("The assistant is still working on the last request.") };
    this.busy = true;
    this.abort = new AbortController();
    this.entries.push({ who: "you", text: prompt, steps: [] });
    const start = this.messages.length;
    const person = s.who;
    s.who = { ...person, via: AI, model: this.config.model };
    beginGroup(s);
    const finish = (note = "", error = "") => {
      if (note) entry.text = (entry.text.trim() + "\n\n" + note).trim();
      if (error) {
        entry.error = error;
        this.messages.length = start; // the conversation must stay valid: the unfinished turn goes (its changes stay, and can be undone)
      }
      endGroup(s);
      s.who = person;
      this.busy = false;
      this.abort = null;
      this.entries.push(entry);
      emit({ type: "done", entry });
      return entry;
    };

    const text: BetaContentBlockParam = { type: "text", text: `Project now (JSON): ${JSON.stringify(run(s, "info"))}\n\nRequest from ${person.name}:\n${prompt}` };
    const last = this.messages[this.messages.length - 1];
    // after a turn cut at the rounds limit the last message is the tool results: the request goes with them
    if (last?.role === "user" && Array.isArray(last.content)) this.messages[this.messages.length - 1] = { role: "user", content: [...last.content, text] };
    else this.messages.push({ role: "user", content: [text] });

    let bad = 0;
    for (let round = 1; ; round++) {
      emit({ type: "round", n: round });
      let m: BetaMessage;
      try {
        m = await this.send(this.params(), this.abort.signal, (t) => emit({ type: "text", text: t }));
        resume();
        bad = 0;
      } catch (e) {
        resume();
        if (this.abort.signal.aborted) return finish("", tr("Stopped."));
        if (e instanceof Anthropic.APIError) return finish("", tr("The API answered: &1", e.message));
        // a tool input that couldn't be read at all, or a stream cut: the same request again
        if (bad++ < MAX_BAD_STREAMS) continue;
        return finish("", tr("Connection error") + ": " + (e instanceof Error ? e.message : String(e)));
      }
      // a refusal can cut a tool call in the middle: nothing of it runs
      if (m.stop_reason === "refusal") return finish("", tr("The model declined this request."));
      for (const b of m.content) {
        if (b.type === "text" && b.text.trim()) entry.text += (entry.text && !entry.text.endsWith("\n") ? "\n\n" : "") + b.text;
        else if (b.type === "server_tool_use" && b.name === "web_search") {
          const q = isObj(b.input) ? String(b.input.query ?? "") : "";
          entry.steps.push(tr("Searched the web") + ": " + q);
          emit({ type: "step", text: entry.steps[entry.steps.length - 1], changed: false });
        }
      }
      const calls = m.content.filter((b) => b.type === "tool_use");
      if (m.stop_reason === "max_tokens") {
        // a tool call cut at the limit may read as a whole one: it doesn't run, and the turn ends without it
        if (calls.length === 0) this.messages.push({ role: "assistant", content: m.content as BetaContentBlockParam[] });
        return finish(tr("The answer was cut (too long)."));
      }
      // the answer goes back as it came (thinking and fallback blocks included)
      this.messages.push({ role: "assistant", content: m.content as BetaContentBlockParam[] });
      if (m.stop_reason === "pause_turn") {
        // a long web search: sent again as it is, the server goes on
        if (round >= MAX_ROUNDS) return finish(tr("It took too many steps; it stopped here."));
        continue;
      }
      if (calls.length === 0) return finish();
      const results: BetaToolResultBlockParam[] = [];
      for (const b of calls) {
        if (b.type !== "tool_use") continue;
        results.push(this.runTool(s, b.id, b.name, b.input, entry, emit));
      }
      this.messages.push({ role: "user", content: results });
      if (round >= MAX_ROUNDS) return finish(tr("It took too many steps; it stopped here. Ask it to go on if needed."));
    }
  }

  /** A call of the tool "sumi", as the AI; its tool_result block */
  private runTool(s: Session, id: string, name: string, input: unknown, entry: Entry, emit: (e: Event) => void): BetaToolResultBlockParam {
    const res = (content: string, isError = false): BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) });
    if (name !== "sumi") return res("Unknown tool " + name, true);
    // the input streams without the server's check: checked here
    if (!isObj(input) || typeof input.command !== "string" || !input.command || (input.args !== undefined && input.args !== null && !isObj(input.args)))
      return res(JSON.stringify({ INVALID_JSON: JSON.stringify(input) }), true);
    const command = input.command;
    const args = isObj(input.args) ? input.args : {};
    const out = run(s, command, args);
    let text = JSON.stringify(out);
    if (text.length > MAX_RESULT) text = text.slice(0, MAX_RESULT) + "... (cut: ask for less, with limit or text)";
    if ("error" in out) {
      entry.steps.push("✗ " + command + ": " + String(out.error));
      emit({ type: "step", text: entry.steps[entry.steps.length - 1], changed: false });
      return res(text, true);
    }
    if (!LOOKING.test(command)) {
      entry.steps.push("✓ " + command + " " + JSON.stringify(args).slice(0, 160));
      emit({ type: "step", text: entry.steps[entry.steps.length - 1], changed: true });
    }
    return res(text);
  }
}

/** For the screens' test (SUMI_AI_CANNED=<file>): the replies of a JSON array, in order, instead of the API */
export function cannedSender(file: string): Sender {
  const replies: BetaMessage[] = JSON.parse(fs.readFileSync(file, "utf8"));
  return async (_params, _signal, onText) => {
    const r = replies.shift();
    if (!r) throw new Anthropic.APIError(500, undefined, "no more canned replies", new Headers());
    for (const b of r.content) if (b.type === "text") onText(b.text);
    return r;
  };
}
