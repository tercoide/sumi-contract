// Where the data lives: a folder (data/ by default, SUMI_DATA to change it) with the company's files, as the
// Gambas version keeps them in ~/.config/sumi-contract/company, and one .contract-proj per project, the same
// file the Gambas version writes. Everything is kept in memory and written at once after each change (to a
// temporary file first, then moved, so a failed write never ruins the old one).
//
// A database (PostgreSQL) comes when the program goes to a server with several people; this is enough for
// one computer, and the files can be copied, opened by the Gambas version, and backed up as they are.

import fs from "node:fs";
import path from "node:path";
import { companyFromFiles, companyToFiles, type Company } from "../model/company.ts";
import { makeId } from "../model/ids.ts";
import { projectFromJson, projectToJson, startProject, type Project } from "../model/project.ts";
import { isObj, tr } from "../model/text.ts";

export const FILE_FORMAT = "sumi-contract";
export const FILE_VERSION = 1;

export class Store {
  dir: string;
  company: Company;
  private projects = new Map<string, Project>();

  constructor(dir: string) {
    this.dir = dir;
    fs.mkdirSync(path.join(dir, "projects"), { recursive: true });
    fs.mkdirSync(path.join(dir, "company"), { recursive: true });
    const files: Record<string, unknown> = {};
    for (const name of ["contractors.json", "standard.json", "log.json", "people.json", "company.json"]) {
      const v = readJson(path.join(dir, "company", name));
      if (v !== undefined) files[name] = v;
    }
    this.company = companyFromFiles(files);
  }

  private projectFile(id: string): string {
    if (!/^[a-z]-[0-9a-z]{12}$/.test(id)) throw new Error(tr("There is no project &1.", id));
    return path.join(this.dir, "projects", id + ".contract-proj");
  }

  /** The projects: id, name, client, modified */
  list(): { id: string; name: string; client: string; location: string; modified: string }[] {
    const out = [];
    for (const f of fs.readdirSync(path.join(this.dir, "projects"))) {
      if (!f.endsWith(".contract-proj")) continue;
      const id = f.slice(0, -".contract-proj".length);
      const p = this.get(id);
      if (p) out.push({ id, name: p.name, client: p.client, location: p.location, modified: p.modified });
    }
    return out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  }

  /** Every project */
  *all(): Iterable<Project> {
    for (const f of fs.readdirSync(path.join(this.dir, "projects"))) {
      if (!f.endsWith(".contract-proj")) continue;
      const p = this.get(f.slice(0, -".contract-proj".length));
      if (p) yield p;
    }
  }

  get(id: string): Project | undefined {
    let p = this.projects.get(id);
    if (p) return p;
    const c = readJson(this.projectFile(id));
    if (!isObj(c)) return undefined;
    p = projectFromJson(c.project, id);
    this.projects.set(id, p);
    return p;
  }

  /** A new project, with a copy of the company's standard library */
  create(): Project {
    const p = startProject(this.company.standard, makeId("p"));
    this.projects.set(p.id, p);
    this.saveProject(p);
    return p;
  }

  /** A .contract-proj (from the Gambas version, or downloaded from here) becomes a new project */
  importFile(text: string): Project {
    let c: unknown;
    try {
      c = JSON.parse(text);
    } catch {
      throw new Error(tr("It is not a sumi-contract project."));
    }
    if (!isObj(c) || c.format !== FILE_FORMAT) throw new Error(tr("It is not a sumi-contract project."));
    if (Number(c.version) > FILE_VERSION) throw new Error(tr("It was saved by a newer sumi-contract (file version &1).", c.version));
    const p = projectFromJson(c.project, makeId("p"));
    this.projects.set(p.id, p);
    this.saveProject(p);
    return p;
  }

  /** The file of a project, as the Gambas version writes it */
  fileOf(p: Project): string {
    return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, project: projectToJson(p) });
  }

  saveProject(p: Project): void {
    writeAtomic(this.projectFile(p.id), this.fileOf(p));
  }

  saveCompany(): void {
    for (const [name, v] of Object.entries(companyToFiles(this.company))) writeAtomic(path.join(this.dir, "company", name), JSON.stringify(v));
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeAtomic(file: string, text: string): void {
  const temp = file + ".saving";
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}
