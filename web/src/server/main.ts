// The server: the commands over HTTP, the projects and the company's data, and the screens (the files Vite
// builds into dist/client). npm start, then open http://localhost:8064
//
//   GET  /api/projects                   the projects
//   POST /api/projects                   a new one -> {id}
//   POST /api/projects/import            a .contract-proj in the body -> {id}
//   GET  /api/projects/<id>/file         the .contract-proj, to download
//   POST /api/run {project?, command, args}   a command (see model/cmd.ts) -> its result
//
// Who: until there are logins (Google, with the company's accounts), the person is SUMI_USER or the computer's
// user, with a permanent id kept in data/people.json.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSON, type Who } from "../model/change.ts";
import { run, type Session } from "../model/cmd.ts";
import { makeId } from "../model/ids.ts";
import { isObj, setCatalog, str } from "../model/text.ts";
import { Store } from "./store.ts";

const here = path.dirname(fileURLToPath(import.meta.url)); // dist/src/server
const root = path.resolve(here, "../../.."); // web/
const port = Number(process.env.SUMI_PORT || 8064);
const store = new Store(process.env.SUMI_DATA || path.join(root, "data"));
const clientDir = path.join(root, "dist/client");
const spanish = new Map<string, string>(Object.entries(JSON.parse(fs.readFileSync(path.join(root, "src/i18n/es.json"), "utf8"))));

/** The texts of a request in the person's language (the screens send it; else the browser's) */
function language(req: http.IncomingMessage): void {
  const l = String(req.headers["x-sumi-lang"] || req.headers["accept-language"] || "");
  setCatalog(l.toLowerCase().startsWith("es") ? spanish : null);
}

/** The person at the screen (one, until logins) */
function who(): Who {
  const name = process.env.SUMI_USER || os.userInfo().username;
  const file = path.join(store.dir, "people.json");
  let people: Record<string, string> = {};
  try {
    people = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  if (!people[name]) {
    people[name] = makeId("u");
    fs.writeFileSync(file, JSON.stringify(people, null, 1));
  }
  return { name, userId: people[name], via: PERSON, model: "" };
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

function session(projectId: string): Session {
  const project = projectId ? (store.get(projectId) ?? null) : null;
  return {
    project,
    company: store.company,
    who: who(),
    group: "",
    library,
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
  if (!url.startsWith("/api/")) return serveStatic(url, res);
  const parts = url.split("?")[0].split("/").filter(Boolean); // ["api", ...]
  language(req);
  if (req.method === "GET" && url === "/api/projects") return send(res, 200, { projects: store.list(), you: who().name });
  if (req.method === "POST" && url === "/api/projects") return send(res, 200, { id: store.create().id });
  if (req.method === "POST" && url === "/api/projects/import") return send(res, 200, { id: store.importFile(await readBody(req)).id });
  if (req.method === "GET" && parts[1] === "projects" && parts[3] === "file") {
    const p = store.get(parts[2]);
    if (!p) return send(res, 404, { error: "no such project" });
    res.setHeader("content-disposition", `attachment; filename="${(p.name || p.id).replace(/[^\w .-]/g, "_")}.contract-proj"`);
    return send(res, 200, store.fileOf(p));
  }
  if (req.method === "POST" && url === "/api/run") {
    const body = JSON.parse((await readBody(req)) || "{}");
    if (!isObj(body)) return send(res, 400, { error: "bad request" });
    const projectId = str(body.project);
    const s = session(projectId);
    if (projectId && !s.project) return send(res, 404, { error: "no such project" });
    return send(res, 200, run(s, str(body.command), isObj(body.args) ? body.args : {}));
  }
  send(res, 404, { error: "unknown" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, { error: e instanceof Error ? e.message : String(e) }));
});
server.listen(port, "127.0.0.1", () => console.log(`sumi-contract: http://localhost:${port} (data in ${store.dir})`));
