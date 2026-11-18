// The AI assistant's loop, with canned replies of the API (as the Gambas smoke test does): the request it
// sends, the tool running the commands as the AI, one turn undone at once, pause_turn, refusals, a stop, a cut
// answer, a tool input that can't be read, the rounds limit.

import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AI, PERSON } from "../src/model/change.ts";
import { run, type Session } from "../src/model/cmd.ts";
import * as Co from "../src/model/company.ts";
import { newProject } from "../src/model/project.ts";
import { Chat, loadAIConfig, MAX_ROUNDS, type AIConfig, type Event, type Sender } from "../src/server/assistant.ts";

const config: AIConfig = { model: "claude-opus-5-5", effort: "high", webSearch: true, apiKey: "" };

function session(): Session {
  return { project: newProject("p-ai"), company: Co.newCompany(), who: { name: "Martín", userId: "u-martin", via: PERSON, model: "" }, group: "" };
}

let n = 0;
/** A reply of the API */
function reply(stop: BetaMessage["stop_reason"], ...content: unknown[]): BetaMessage {
  return { id: "msg_" + ++n, type: "message", role: "assistant", model: config.model, content, stop_reason: stop, stop_sequence: null, usage: {} } as unknown as BetaMessage;
}
const text = (t: string) => ({ type: "text", text: t, citations: null });
const call = (command: string, args?: unknown) => ({ type: "tool_use", id: "toolu_" + ++n, name: "sumi", input: args === undefined ? { command } : { command, args } });

/** A sender that answers with these replies (or throws these errors) in order, and keeps the requests */
function canned(...replies: (BetaMessage | Error)[]): Sender & { requests: MessageCreateParamsBase[] } {
  const requests: MessageCreateParamsBase[] = [];
  const f = async (p: MessageCreateParamsBase, _signal: AbortSignal, onText: (t: string) => void) => {
    requests.push(structuredClone(p));
    const r = replies.shift();
    if (!r) throw new Error("no more canned replies");
    if (r instanceof Error) throw r;
    for (const b of r.content) if (b.type === "text") onText(b.text);
    return r;
  };
  return Object.assign(f, { requests });
}

test("the request", () => {
  const p = new Chat(config, canned()).params();
  assert.equal(p.model, "claude-opus-5-5");
  assert.deepEqual(p.output_config, { effort: "high" }, "the effort, set explicitly");
  assert.deepEqual(p.thinking, { type: "adaptive" });
  assert.ok(p.betas?.includes("server-side-fallback-2026-07-01") && p.fallbacks === "default", "server-side fallbacks");
  assert.deepEqual(p.cache_control, { type: "ephemeral" }, "prompt caching");
  const tools = p.tools as any[];
  assert.ok(tools[0].name === "sumi" && tools[0].eager_input_streaming && tools[0].description.includes("resource.set"), "the sumi tool, with the commands");
  assert.ok(tools.some((t) => t.type === "web_search_20260209" && t.user_location.country === "AR"), "web search from Argentina");
  assert.ok(!(new Chat({ ...config, webSearch: false }, canned()).params().tools as any[]).some((t) => t.type), "no web search when it's off");
  assert.ok(!new Chat({ ...config, model: "claude-haiku-5-5" }, canned()).params().fallbacks, "no fallbacks for a model that doesn't take them");
  assert.equal(loadAIConfig("/nonexistent", { SUMI_AI_EFFORT: "xhigh", SUMI_AI_WEB_SEARCH: "0" }).effort, "xhigh");
  assert.equal(loadAIConfig("/nonexistent", { SUMI_AI_WEB_SEARCH: "0" }).webSearch, false);
});

test("a turn: commands run as the AI, one group, undone at once", async () => {
  const s = session();
  const send = canned(
    reply("tool_use", { type: "thinking", thinking: "", signature: "sig" }, text("Agrego el cemento."), call("resource.list"), call("resource.add", { kind: "material", name: "Cemento", unit: "kg", price: 250 })),
    reply("pause_turn", { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "precio cal hidratada" } }),
    reply("tool_use", call("resource.add", { kind: "material", name: "Cal", unit: "kg", price: 120, source: "https://example.com" }), call("resource.set", { key: "nada", price: 1 })),
    reply("end_turn", text("Listo: cemento y cal.")),
  );
  const chat = new Chat(config, send);
  const events: Event[] = [];
  const e = await chat.ask(s, "agregá cemento y cal", (x) => events.push(x));
  assert.ok(!e.error, e.error);
  assert.equal(send.requests.length, 4, "four requests: tool results, pause_turn resent, tool results, done");
  assert.deepEqual([...s.project!.prices.resources.values()].map((r) => r.name), ["Cemento", "Cal"], "both resources made");
  const changes = s.project!.changes;
  assert.ok(changes.every((h) => h.via === AI && h.model === "claude-opus-5-5" && h.who === "Martín"), "logged as the AI with its model, for its person");
  assert.ok(changes.length === 2 && changes[0].group && changes[0].group === changes[1].group, "one group");
  assert.ok(e.text.includes("Agrego el cemento.") && e.text.includes("Listo"), "the answer");
  assert.ok(e.steps.some((x) => x.includes("precio cal hidratada")) && e.steps.some((x) => x.startsWith("✗ resource.set")) && e.steps.filter((x) => x.startsWith("✓")).length === 2, "the steps: " + e.steps.join(" | "));
  assert.ok(!e.steps.some((x) => x.includes("resource.list")), "looking isn't a step");
  assert.ok(events.some((x) => x.type === "step" && x.changed) && events[events.length - 1].type === "done", "events as it goes");
  assert.equal(s.who.via, PERSON, "the session is the person's again");
  // the conversation: the reply went back as it came (thinking included), the error as is_error
  const second = send.requests[1].messages;
  assert.deepEqual((second[1].content as any[])[0], { type: "thinking", thinking: "", signature: "sig" }, "thinking goes back unchanged");
  const results = second[2].content as any[];
  assert.ok(results.length === 2 && results.every((r) => r.type === "tool_result") && results[1].content.includes('"ok":true'), "both results in one message");
  assert.ok((send.requests[3].messages[5].content as any[])[1].is_error, "a failed command is an error result");
  assert.ok((send.requests[0].messages[0].content as any[])[0].text.includes("Request from Martín"), "the request says who asks, with the project");
  assert.equal(send.requests[2].messages.length, 4, "pause_turn: sent again as it is, no message added");
  // the person undoes the whole turn
  s.who = { name: "Martín", userId: "u-martin", via: PERSON, model: "" };
  assert.ok(run(s, "undo").ok);
  assert.equal(s.project!.prices.resources.size, 0, "undo takes back the whole turn");

  // the next turn goes on with the same conversation
  const before = chat.messages.length;
  const send2 = canned(reply("end_turn", text("De nada.")));
  (chat as any).send = send2;
  await chat.ask(s, "gracias", () => {});
  assert.ok(send2.requests[0].messages.length === before + 1 && chat.entries.length === 4, "the conversation goes on");
  assert.ok(chat.newChat());
  assert.ok((chat.messages as unknown[]).length === 0 && (chat.entries as unknown[]).length === 0, "a new chat");
});

test("what ends a turn badly", async () => {
  const s = session();
  // a refusal: its tool call doesn't run, the turn leaves the conversation
  let chat = new Chat(config, canned(reply("refusal", call("resource.add", { kind: "material", name: "X", unit: "u" }))));
  let e = await chat.ask(s, "algo", () => {});
  assert.ok(e.error && s.project!.prices.resources.size === 0 && chat.messages.length === 0, "a refusal");
  // an API error
  chat = new Chat(config, canned(new Anthropic.APIError(401, undefined, "invalid x-api-key", new Headers())));
  e = await chat.ask(s, "algo", () => {});
  assert.ok(e.error?.includes("invalid x-api-key") && !chat.busy, "an API error: " + e.error);
  // a stream cut is tried again
  chat = new Chat(config, canned(new Error("stream ended"), reply("end_turn", text("ok"))));
  e = await chat.ask(s, "algo", () => {});
  assert.ok(!e.error && e.text === "ok", "a cut stream, sent again");
  // a tool input that can't be read
  const send = canned(reply("tool_use", { type: "tool_use", id: "toolu_x", name: "sumi", input: { command: "resource.add", args: "kind" } }), reply("end_turn", text("perdón")));
  chat = new Chat(config, send);
  await chat.ask(s, "algo", () => {});
  assert.ok((send.requests[1].messages[2].content as any[])[0].content.includes("INVALID_JSON"), "an input that isn't the schema's is sent back as an error");
  // cut at max_tokens: the call doesn't run
  chat = new Chat(config, canned(reply("max_tokens", text("Voy a"), call("resource.add", { kind: "material", name: "Y", unit: "u" }))));
  e = await chat.ask(s, "algo", () => {});
  assert.ok(e.text.includes("Voy a") && s.project!.prices.resources.size === 0 && chat.messages.length === 1, "cut: nothing runs");
  // stopped while waiting
  let release!: () => void;
  chat = new Chat(config, (_p, signal) => new Promise((_ok, no) => ((release = () => no(new Error("aborted"))), signal.addEventListener("abort", () => release()))));
  const going = chat.ask(s, "algo largo", () => {});
  assert.ok(chat.busy && (await chat.ask(s, "otra", () => {})).error, "one request at a time");
  chat.stop();
  e = await going;
  assert.ok(e.error && !chat.busy && chat.messages.length === 0, "stopped");
  // the rounds limit
  const many = Array.from({ length: MAX_ROUNDS }, () => reply("tool_use", call("info")));
  chat = new Chat(config, canned(...many));
  e = await chat.ask(s, "en bucle", () => {});
  assert.ok(!e.error && e.text.includes("too many steps"), "the rounds limit");
  const send3 = canned(reply("end_turn", text("sigo")));
  (chat as any).send = send3;
  await chat.ask(s, "seguí", () => {});
  const last = send3.requests[0].messages[send3.requests[0].messages.length - 1];
  assert.ok(last.role === "user" && (last.content as any[])[0].type === "tool_result" && (last.content as any[]).at(-1).type === "text", "after the limit, the request goes with the last tool results");
});
