// The server: the commands over HTTP, the projects and the company's data, and the screens (the files Vite
// builds into dist/client). npm start, then open http://localhost:8064
//
//   GET  /api/projects                   the projects
//   POST /api/projects                   a new one -> {id}
//   POST /api/projects/import            a .contract-proj in the body -> {id}
//   GET  /api/projects/<id>/file         the .contract-proj, to download
//   GET  /api/projects/<id>/report/<kind>?contract=&cert=&lang=   a PDF report (model/reports.ts)
//   POST /api/run {project?, command, args}   a command (see model/cmd.ts) -> its result
//   GET  /api/me                         who is signed in, and whether logins are on
//   GET  /api/assistant?project=         the AI assistant: its settings and the conversation shown
//   POST /api/assistant {project, prompt}   a request to it: what it does streams back as JSON lines
//   POST /api/assistant/stop|new {project}   stop it, or forget the conversation (assistant.ts)
//   /auth/login, /auth/callback, /auth/logout   signing in with Google (auth.ts)
//
// Who: the person signed in with Google (their company account), when the Google keys are there (see auth.ts);
// else SUMI_USER or the computer's user. Each has a permanent id kept in data/people.json.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSON, type Who } from "../model/change.ts";
import { run, type Session } from "../model/cmd.ts";
import { makeId } from "../model/ids.ts";
import { isObj, setCatalog, str, tr } from "../model/text.ts";
import { makeReport } from "../model/reports.ts";
import { apiSender, cannedSender, Chat, hasKey, loadAIConfig, type Sender } from "./assistant.ts";
import { Auth, loadAuth, type Person } from "./auth.ts";
import { Store } from "./store.ts";

const here = path.dirname(fileURLToPath(import.meta.url)); // dist/src/server
const root = path.resolve(here, "../../.."); // web/
const port = Number(process.env.SUMI_PORT || 8064);
const store = new Store(process.env.SUMI_DATA || path.join(root, "data"));
const clientDir = path.join(root, "dist/client");
let auth: Auth | null = null;
try {
  const c = loadAuth(store.dir, port);
  if (c) auth = new Auth(c, store.dir);
} catch (e) {
  console.error("sumi-contract: " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}
const ai = loadAIConfig(store.dir);
const sender: Sender = process.env.SUMI_AI_CANNED ? cannedSender(process.env.SUMI_AI_CANNED) : apiSender(ai);
const chats = new Map<string, Chat>(); // by person and project

function chatOf(w: Who, project: string): Chat {
  const key = w.userId + "|" + project;
  let c = chats.get(key);
  if (!c) chats.set(key, (c = new Chat(ai, sender)));
  return c;
}

const spanish = new Map<string, string>(Object.entries(JSON.parse(fs.readFileSync(path.join(root, "src/i18n/es.json"), "utf8"))));

/** The texts of a request in the person's language (the screens send it; else the browser's) */
function language(req: http.IncomingMessage): void {
  const q = new URL(req.url ?? "/", "http://x").searchParams.get("lang");
  const l = String(q || req.headers["x-sumi-lang"] || req.headers["accept-language"] || "");
  setCatalog(l.toLowerCase().startsWith("es") ? spanish : null);
}

/** The person making the request: signed in with Google (by their address), or the computer's user */
function who(person: Person | null): Who {
  const name = person ? person.name : process.env.SUMI_USER || os.userInfo().username;
  const key = person ? person.email : name;
  const file = path.join(store.dir, "people.json");
  let people: Record<string, string> = {};
  try {
    people = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  if (!people[key]) {
    people[key] = makeId("u");
    fs.writeFileSync(file, JSON.stringify(people, null, 1));
  }
  return { name, userId: people[key], via: PERSON, model: "" };
}

/** A library shipped with the program: library/<name>/*.csv, and library/added */
function library(name: string) {
  const read = (dir: string) => {
    if (!/^[\w-]+$/.test(path.basename(dir)) || !fs.existsSync(dir)) return undefined;
    const files: Record<string, string> = {};
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".csv")) files[f] = fs.readFileSync(path.join(dir, f), "utf8");
    return files;
  };
  if (!/^[\w-]+$/.test(name) || name === "added") return undefined;
  const files = read(path.join(root, "library", name));
  return files && { files, added: read(path.join(root, "library", "added")) };
}

/** Where a report can be downloaded */
function reportUrl(project: string, kind: string, contract = "", cert = ""): string {
  const q = new URLSearchParams();
  if (contract) q.set("contract", contract);
  if (cert) q.set("cert", cert);
  return `/api/projects/${project}/report/${kind}` + (q.size ? "?" + q : "");
}

function session(projectId: string, person: Person | null): Session {
  const project = projectId ? (store.get(projectId) ?? null) : null;
  return {
    project,
    company: store.company,
    who: who(person),
    group: "",
    library,
    extra: {
      // the PDF is made to see it can be; the screens (or the person the AI works for) download it from the url
      "report.pdf": (_x, c) => {
        if (!project) return { error: tr("Open a project first.") };
        const r = makeReport(project, store.company, str(c.kind), str(c.contract), str(c.cert));
        if (r.error) return { error: r.error };
        return { ok: true, url: reportUrl(project.id, str(c.kind), str(c.contract), str(c.cert)), name: r.name, pages: r.pages };
      },
    },
    changed: (what) => (what === "company" ? store.saveCompany() : project && store.saveProject(project)),
  };
}

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024 * 1024) throw new Error("too big");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };

function serveStatic(url: string, res: http.ServerResponse): void {
  let file = path.normalize(path.join(clientDir, decodeURIComponent(url.split("?")[0])));
  if (!file.startsWith(clientDir)) return send(res, 404, "not found", "text/plain");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(clientDir, "index.html"); // the screens route themselves
  if (!fs.existsSync(file)) return send(res, 404, "The screens aren't built: npm run build", "text/plain; charset=utf-8");
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  if (url.startsWith("/auth/")) {
    language(req);
    if (auth && (await auth.handle(req, res))) return;
    return send(res, 404, "not found", "text/plain");
  }
  if (!url.startsWith("/api/")) return serveStatic(url, res);
  const parts = url.split("?")[0].split("/").filter(Boolean); // ["api", ...]
  language(req);
  const person = auth ? auth.person(req) : null;
  if (req.method === "GET" && url === "/api/me") return send(res, 200, { login: !!auth, person: auth ? person : { name: who(null).name, email: "", picture: "" } });
  if (auth && !person) return send(res, 401, { error: tr("Sign in first."), login: true });
  // with logins, only the program's own pages may send changes (the cookie is SameSite=Lax too)
  const origin = req.headers.origin;
  if (auth && req.method !== "GET" && origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: "forbidden" });
  if (req.method === "GET" && url === "/api/projects") return send(res, 200, { projects: store.list(), you: who(person).name });
  if (req.method === "POST" && url === "/api/projects") return send(res, 200, { id: store.create().id });
  if (req.method === "POST" && url === "/api/projects/import") return send(res, 200, { id: store.importFile(await readBody(req)).id });
  if (req.method === "GET" && parts[1] === "projects" && parts[3] === "file") {
    const p = store.get(parts[2]);
    if (!p) return send(res, 404, { error: "no such project" });
    res.setHeader("content-disposition", `attachment; filename="${(p.name || p.id).replace(/[^\w .-]/g, "_")}.contract-proj"`);
    return send(res, 200, store.fileOf(p));
  }
  if (req.method === "GET" && parts[1] === "projects" && parts[3] === "report" && parts[4]) {
    const p = store.get(parts[2]);
    if (!p) return send(res, 404, { error: "no such project" });
    const q = new URL(url, "http://x").searchParams;
    const r = makeReport(p, store.company, parts[4], q.get("contract") ?? "", q.get("cert") ?? "");
    if (r.error || !r.pdf) return send(res, 400, r.error ?? "?", "text/plain; charset=utf-8");
    res.writeHead(200, { "content-type": "application/pdf", "content-length": r.pdf.length, "cache-control": "no-store", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.name!)}` });
    return void res.end(r.pdf);
  }
  if (parts[1] === "assistant") {
    const q = new URL(url, "http://x").searchParams;
    const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : {};
    const projectId = str(q.get("project") || body.project);
    const s = session(projectId, person);
    if (!s.project) return send(res, 404, { error: tr("Open a project first.") });
    const chat = chatOf(s.who, projectId);
    if (req.method === "GET") return send(res, 200, { model: ai.model, effort: ai.effort, webSearch: ai.webSearch, key: hasKey(ai), busy: chat.busy, entries: chat.entries });
    if (parts[2] === "stop") return send(res, 200, (chat.stop(), { ok: true }));
    if (parts[2] === "new") return send(res, 200, chat.newChat() ? { ok: true } : { error: tr("The assistant is still working on the last request.") });
    const prompt = str(body.prompt).trim();
    if (!prompt) return send(res, 400, { error: "no prompt" });
    if (chat.busy) return send(res, 409, { error: tr("The assistant is still working on the last request.") });
    // what happens, as JSON lines; the person's language is kept for the whole turn
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
    res.on("close", () => !res.writableEnded && chat.stop()); // the page closed: the turn stops
    await chat.ask(
      s,
      prompt,
      (e) => !res.writableEnded && res.write(JSON.stringify(e) + "\n"),
      () => language(req), // other requests may have changed the language while it waited
    );
    return void res.end();
  }
  if (req.method === "POST" && url === "/api/run") {
    const body = JSON.parse((await readBody(req)) || "{}");
    if (!isObj(body)) return send(res, 400, { error: "bad request" });
    const projectId = str(body.project);
    const s = session(projectId, person);
    if (projectId && !s.project) return send(res, 404, { error: "no such project" });
    return send(res, 200, run(s, str(body.command), isObj(body.args) ? body.args : {}));
  }
  send(res, 404, { error: "unknown" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, { error: e instanceof Error ? e.message : String(e) }));
});
// SUMI_HOST=0.0.0.0 to be reached from other computers (only with logins on)
const host = process.env.SUMI_HOST || "127.0.0.1";
if (!auth && host !== "127.0.0.1" && host !== "localhost") {
  console.error("sumi-contract: without Google sign-in it only listens on this computer (see src/server/auth.ts)");
  process.exit(1);
}
server.listen(port, host, () => console.log(`sumi-contract: ${auth ? auth.config.url : "http://localhost:" + port} (data in ${store.dir}; ${auth ? "Google sign-in" : "no logins: " + who(null).name})`));
