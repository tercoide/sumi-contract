// The server: the commands (model/cmd.ts) and the projects.

import { lang } from "./tr.ts";

export type Result = Record<string, any>;

/** A session that ended (signed out elsewhere, or 30 days): back to the sign-in */
function signedOut(r: Response): void {
  if (r.status === 401) location.reload();
}

async function post(url: string, body: unknown, raw = false): Promise<Result> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": raw ? "application/octet-stream" : "application/json", "x-sumi-lang": lang }, body: raw ? (body as string) : JSON.stringify(body) });
  signedOut(r);
  try {
    return await r.json();
  } catch {
    return { error: `HTTP ${r.status}` };
  }
}

/** Runs a command; {ok, ...} or {error} */
export function run(project: string, command: string, args: Record<string, unknown> = {}): Promise<Result> {
  return post("/api/run", { project, command, args });
}

export async function listProjects(): Promise<Result> {
  const r = await fetch("/api/projects", { headers: { "x-sumi-lang": lang } });
  signedOut(r);
  return r.json();
}

/** Who is signed in: {login (logins are on), person: {name, email, picture} or null} */
export async function me(): Promise<Result> {
  try {
    return await (await fetch("/api/me", { headers: { "x-sumi-lang": lang } })).json();
  } catch {
    return { login: false, person: null, error: true };
  }
}

export const loginUrl = () => "/auth/login?back=" + encodeURIComponent(location.hash);

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" });
  location.reload();
}

/** Opens a PDF report in a new tab, or says why it can't be made. args: {kind, contract?, cert?} */
export async function openReport(project: string, args: Record<string, unknown>): Promise<Result> {
  const tab = window.open("", "_blank"); // opened now, while the click counts: browsers block it later
  const r = await run(project, "report.pdf", args);
  if (r.error || !r.url) tab?.close();
  else if (tab) tab.location.href = r.url + (r.url.includes("?") ? "&" : "?") + "lang=" + lang;
  else location.href = r.url;
  return r;
}

export const newProject = () => post("/api/projects", {});
export const importProject = (text: string) => post("/api/projects/import", text, true);
export const fileUrl = (id: string) => `/api/projects/${id}/file`;

// THE AI ASSISTANT

export async function assistantState(project: string): Promise<Result> {
  const r = await fetch("/api/assistant?project=" + encodeURIComponent(project), { headers: { "x-sumi-lang": lang } });
  signedOut(r);
  return r.json();
}

export const assistantStop = (project: string) => post("/api/assistant/stop", { project });
export const assistantNew = (project: string) => post("/api/assistant/new", { project });

/** A request to the assistant; onEvent gets what it does as it happens ({type: text|step|round|done}) */
export async function askAssistant(project: string, prompt: string, onEvent: (e: Result) => void): Promise<void> {
  const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json", "x-sumi-lang": lang }, body: JSON.stringify({ project, prompt }) });
  signedOut(r);
  if (!r.ok || !r.body) {
    let why = `HTTP ${r.status}`;
    try {
      why = (await r.json()).error ?? why;
    } catch {}
    onEvent({ type: "done", entry: { who: "ai", text: "", steps: [], error: why } });
    return;
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += value;
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const l of lines) if (l.trim()) onEvent(JSON.parse(l));
  }
}
