// Roles: who may change what, the company's people, a project's members, undo with the rights of what it
// undoes, and the AI working with its person's rights.

import assert from "node:assert/strict";
import { test } from "node:test";
import { PERSON } from "../src/model/change.ts";
import { help, rightsIn, run, type Session } from "../src/model/cmd.ts";
import * as Co from "../src/model/company.ts";
import { newProject, projectFromJson, projectToJson } from "../src/model/project.ts";
import { isListed, needs, rightsOf } from "../src/model/roles.ts";

function session(roles: string[] | null, co = Co.newCompany(), p = newProject("p-roles")): Session {
  return { project: p, company: co, who: { name: "Ana", userId: "u-ana", via: PERSON, model: "" }, rights: roles ? rightsOf(roles) : undefined, group: "" };
}
const must = (s: Session, c: string, a: Record<string, unknown> = {}) => {
  const r = run(s, c, a);
  assert.ok(r.ok, `${c}: ${JSON.stringify(r)}`);
  return r as Record<string, any>;
};
const refused = (s: Session, c: string, a: Record<string, unknown> = {}) => String(run(s, c, a).error ?? "").includes("needs the right");

test("every command has its right", () => {
  for (const c of Object.keys(help())) assert.ok(isListed(c), `${c} is in roles.ts`);
  assert.deepEqual(needs("resource.list"), [], "reading needs nothing");
  assert.deepEqual(needs("something.new"), ["admin"], "an unlisted command needs admin");
  assert.deepEqual(needs("cert.set", { contract: "C-01", cert: 1, status: "issued" }), ["certify"]);
  assert.deepEqual(needs("cert.set", { contract: "C-01", cert: 1, status: "issued", note: "x" }).sort(), ["certify", "contracts"]);
});

test("what each role may change", () => {
  const s = session(["estimator"]);
  must(s, "resource.add", { kind: "material", name: "Cemento", unit: "kg", price: 10 });
  assert.ok(refused(s, "task.set", { item: "x", days: 3 }), "an estimator can't change the Gantt");
  assert.ok(refused(s, "contract.add", { contractor: "x" }), "nor make contracts");
  assert.ok(refused(s, "person.add", { email: "x@y.com" }), "nor manage people");
  assert.ok(must(s, "resource.list").resources.length === 1 && must(s, "info").rights.includes("prices"), "reading, and info says the rights");
  assert.equal(must(session(null), "info").rights, "all", "no rights given: everything (no logins)");
  const v = session(["viewer"], s.company, s.project!);
  assert.ok(refused(v, "resource.set", { key: "MAT-0001", price: 5 }) && must(v, "resource.list").resources[0].unitPrice === 10, "a viewer only looks");
  // undo needs the rights of what it undoes
  const ana = session(["estimator"], s.company, s.project!);
  must(ana, "resource.set", { key: "MAT-0001", price: 12 });
  ana.rights = rightsOf(["viewer"]);
  assert.ok(refused(ana, "undo") && must(ana, "resource.list").resources[0].unitPrice === 12, "a role taken away: no undo of that");
  ana.rights = rightsOf(["estimator"]);
  must(ana, "undo");
  assert.equal(must(ana, "resource.list").resources[0].unitPrice, 10);
});

test("people and project members", () => {
  const co = Co.newCompany();
  const admin = session(["admin"], co);
  const id = must(admin, "person.add", { email: "Juan@Empresa.com", name: "Juan", roles: ["estimator"] }).id;
  assert.ok(run(admin, "person.add", { email: "juan@empresa.com" }).error, "once");
  assert.ok(run(admin, "person.add", { email: "nobody" }).error, "an address");
  assert.ok(run(admin, "person.set", { key: "Juan", roles: ["boss"] }).error, "only roles that exist");
  must(admin, "person.set", { key: "juan@empresa.com", roles: ["estimator", "planner"] });
  assert.deepEqual(co.people.get(id)!.roles, ["estimator", "planner"]);
  assert.ok(co.changes.length === 2 && co.changes.every((h) => h.targets[0] === "person:" + id), "logged in the company's log");
  must(admin, "undo");
  assert.deepEqual(co.people.get(id)!.roles, ["estimator"], "undone");
  // the last administrator stays
  const boss = must(admin, "person.add", { email: "boss@empresa.com", roles: ["admin"] }).id;
  assert.ok(run(admin, "person.set", { key: boss, roles: [] }).error && run(admin, "person.delete", { key: boss }).error, "the only administrator can't go");
  must(admin, "person.set", { key: id, roles: ["estimator", "admin"] });
  must(admin, "person.set", { key: boss, roles: [] });
  // a project's members: roles there only
  const p = admin.project!;
  assert.ok(!rightsIn(co, p, boss).has("certify"));
  must(admin, "member.set", { person: "boss@empresa.com", roles: ["director"] });
  assert.ok(rightsIn(co, p, boss).has("certify") && !rightsIn(co, newProject("other"), boss).has("certify"), "a member's roles count in that project only");
  assert.equal(must(admin, "member.list").members[0].roles[0], "director");
  const back = projectFromJson(JSON.parse(JSON.stringify(projectToJson(p))), p.id);
  assert.equal(back.members.length, 1, "the members are in the file");
  assert.ok(!("members" in projectToJson(newProject())), "not written when there are none (the Gambas file stays the same)");
  must(admin, "member.set", { person: boss, roles: [] });
  assert.equal(p.members.length, 0, "no roles: not a member");
  assert.ok(rightsIn(co, null, id, ["admin"]).has("admin"), "the configured admins");
  const files = Co.companyToFiles(co);
  assert.equal(Co.companyFromFiles(files).people.size, 2, "people.json");
});

test("the company's data and people survive a restart of the server", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { Store } = await import("../src/server/store.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sumi-store-"));
  let store = new Store(dir);
  const s: Session = { project: null, company: store.company, who: { name: "Ana", userId: "u-ana", via: PERSON, model: "" }, rights: rightsOf(["admin"]), group: "", changed: () => store.saveCompany() };
  must(s, "person.add", { email: "juan@empresa.com", roles: ["treasury"] });
  must(s, "company.set", { name: "Constructora Sur SA", taxId: "30-12345678-9", address: "Corrientes" });
  assert.ok(run({ ...s, rights: rightsOf(["estimator"]) }, "company.set", { name: "x" }).error, "only administrators change it");
  assert.ok(run(s, "company.set", { color: "red" }).error, "only its fields");
  store = new Store(dir);
  assert.deepEqual([...store.company.people.values()].map((k) => k.roles), [["treasury"]], "people.json is read again");
  assert.equal(store.company.info.name, "Constructora Sur SA", "company.json is read again");
  fs.rmSync(dir, { recursive: true });
});
