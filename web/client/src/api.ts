// The server: the commands (model/cmd.ts) and the projects.

import { lang } from "./tr.ts";

export type Result = Record<string, any>;

async function post(url: string, body: unknown, raw = false): Promise<Result> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": raw ? "application/octet-stream" : "application/json", "x-sumi-lang": lang }, body: raw ? (body as string) : JSON.stringify(body) });
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
  return r.json();
}

export const newProject = () => post("/api/projects", {});
export const importProject = (text: string) => post("/api/projects/import", text, true);
export const fileUrl = (id: string) => `/api/projects/${id}/file`;
