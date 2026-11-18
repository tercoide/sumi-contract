// The screens' test (as the Gambas version's --gui-test): starts the server on a temporary folder, opens a
// project written by the Gambas version, goes through every tab, edits a few things and checks they are
// logged and undone, and fails at the first error of the page. npm run gui-test (after npm run build).
// GUI_SHOTS=<dir> saves a screenshot of each tab; GUI_LANG=en runs it in English (default Spanish).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "sumi-gui-"));
const port = 8000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const shots = process.env.GUI_SHOTS;
const lang = process.env.GUI_LANG || "es";
let failures = 0;

function check(ok, what) {
  if (ok) console.log("ok   " + what);
  else {
    failures++;
    console.log("FAIL " + what);
  }
}

// the AI assistant answers with canned replies: a command, then a text
const canned = path.join(data, "ai-replies.json");
const msg = (stop, content) => ({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: {} });
fs.writeFileSync(canned, JSON.stringify([
  msg("tool_use", [{ type: "text", text: "Agrego el insumo.", citations: null }, { type: "tool_use", id: "toolu_1", name: "sumi", input: { command: "resource.add", args: { kind: "material", name: "Arena gruesa IA", unit: "m3", price: 30000 } } }]),
  msg("end_turn", [{ type: "text", text: "Listo: agregué Arena gruesa IA.", citations: null }]),
]));
const server = spawn(process.execPath, ["dist/src/server/main.js"], { cwd: web, env: { ...process.env, GOOGLE_CLIENT_ID: "", SUMI_GOOGLE_KEYS: "/nonexistent", SUMI_DATA: data, SUMI_PORT: String(port), SUMI_USER: "Tester", SUMI_AI_CANNED: canned }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok) => server.stdout.once("data", ok));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, locale: lang === "es" ? "es-AR" : "en-US" });
  const errors = [];
  page.on("pageerror", (e) => (errors.push(e.message), process.env.GUI_VERBOSE && console.log("PAGE ERROR", e.stack)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, name + ".png") }));
  const api = async (command, args = {}) => (await fetch(base + "/api/run", { method: "POST", body: JSON.stringify({ project: id, command, args }) })).json();

  // the list, empty, then a file of the Gambas version
  await page.goto(base);
  await page.waitForSelector(".projects");
  check((await page.textContent(".projects")).length > 0, "the list of projects");
  await shot("0-projects");
  const r = await (await fetch(base + "/api/projects/import", { method: "POST", body: fs.readFileSync(path.join(web, "test/gambas/contracts.contract-proj")) })).json();
  const id = r.id;
  check(!!id, "a Gambas file imported");

  // every tab
  for (const tab of ["project", "budget", "gantt", "pricing", "contracts", "history"]) {
    await page.goto(`${base}/#/p/${id}/${tab}`);
    await page.waitForFunction(() => !document.querySelector("main.tab")?.textContent?.trim().startsWith("…"));
    await page.waitForTimeout(150);
    check(errors.length === 0, `the ${tab} tab opens: ${errors.join("; ")}`);
    await shot("tab-" + tab);
  }

  // the Project tab: typing a name changes the project, logged; undo puts it back
  await page.goto(`${base}/#/p/${id}/project`);
  const name = page.locator("label.row", { hasText: lang === "es" ? "Nombre" : "Name" }).first().locator("input");
  await name.fill("Casa de prueba");
  await name.press("Enter");
  await page.waitForFunction(() => document.querySelector(".bar .title")?.textContent === "Casa de prueba");
  check((await api("info")).name === "Casa de prueba", "a field changes the project");
  await page.click(".bar button:first-of-type");
  await page.waitForFunction(() => document.querySelector(".bar .title")?.textContent !== "Casa de prueba");
  check((await api("info")).name !== "Casa de prueba", "undo from the top bar");

  // the Budget tab: a quantity typed the Spanish way
  await page.goto(`${base}/#/p/${id}/budget`);
  const q = page.locator("table.budget tbody tr:not(.rubro) td.num input").first();
  await q.waitFor();
  await q.fill(lang === "es" ? "1.234,5" : "1,234.5");
  await q.press("Enter");
  await page.waitForTimeout(300);
  const items = (await api("budget.list")).items;
  check(items[0].qty === 1234.5, "a quantity typed the person's way: " + items[0].qty);
  await shot("budget-edited");

  // the Pricing tab: import licita2003 with the button, open analysis 1, change a line, look at a machine
  await page.goto(`${base}/#/p/${id}/pricing`);
  await page.click(".toolbar button:first-of-type");
  await page.click("section button:has-text('licita2003')");
  await page.waitForSelector(".report pre");
  check((await api("book.get")).analyses >= 467, "the licita2003 library imported from the screen");
  await shot("pricing-imported");
  await page.fill(".listside input.search", "Excavacion para sanjas");
  await page.locator(".listside tr.link").first().click();
  await page.waitForSelector("table.sheet tr.rubro");
  check((await page.textContent("table.sheet")).includes("90009"), "analysis 1's sheet shows its labor");
  const line = page.locator("table.sheet td.num input").first();
  await line.fill(lang === "es" ? "6,8" : "6.8");
  await line.press("Enter");
  await page.waitForTimeout(300);
  const a1 = (await api("analysis.get", { key: "1" })).analysis;
  check(Math.abs(a1.direct - 6.8 * 2.79) < 1e-9, "a line's quantity changes the analysis: " + a1.direct);
  await shot("pricing-analysis");
  await page.click(".subtabs button:nth-child(2)");
  await page.fill("input.search", "Excavadora");
  await page.locator("table.resources tbody tr").first().click();
  await page.waitForSelector(".machine");
  check((await page.textContent("section")).includes("104"), "the machine calculation of an equipment");
  await shot("pricing-machine");
  for (const n of [3, 4]) {
    await page.click(`.subtabs button:nth-child(${n})`);
    await page.waitForTimeout(150);
  }
  await shot("pricing-rubros");
  check(errors.length === 0, "the Pricing pages: " + errors.join("; "));
  await api("undo");
  await api("undo");

  // the Gantt tab: the bars, a duration typed, the curve
  await page.goto(`${base}/#/p/${id}/gantt`);
  await page.waitForSelector("table.gantt .bar");
  const days = page.locator("table.gantt tbody tr:not(.rubro) td.num input").first();
  await days.fill("12");
  await days.press("Enter");
  await page.waitForTimeout(300);
  check((await api("schedule.get")).length === 12, "a task's days change the Gantt");
  check((await page.locator(".curve svg rect").count()) > 0, "the investment curve");
  await shot("gantt");

  // the Contracts tab: a contractor of the company, a contract, a certificate measured, a payment
  await page.goto(`${base}/#/p/${id}/contracts`);
  await page.click("button:has-text('" + (lang === "es" ? "Contratistas..." : "Contractors...") + "')");
  await page.fill(".contractors input[placeholder]", "Constructora Sur");
  await page.click(".contractors .toolbar button:has-text('" + (lang === "es" ? "Agregar" : "Add") + "')");
  await page.waitForSelector(".contractors .row");
  check((await api("contractor.list")).contractors.some((k) => k.name === "Constructora Sur"), "a contractor added from the screen");
  check((await page.textContent(".contractors table.grid tbody")).includes("Constructora Sur"), "the contractors list shows it");
  await shot("contractors");
  await page.selectOption(".toolbar select", { label: "Constructora Sur" });
  await page.click(".toolbar button:has-text('" + (lang === "es" ? "Contrato nuevo" : "New contract") + "')");
  await page.waitForTimeout(300);
  const contracts = (await api("contract.list")).contracts;
  const c3 = contracts[contracts.length - 1];
  check(c3.contractor === "Constructora Sur", "a new contract");
  await page.selectOption(".toolbar select >> nth=-1", { index: 1 });
  await page.click(".toolbar button:has-text('" + (lang === "es" ? "Agregar" : "Add") + "') >> nth=-1");
  await page.waitForTimeout(300);
  await page.click(".subtabs button:nth-child(2)");
  await page.click("button:has-text('" + (lang === "es" ? "Este período" : "This period") + "')");
  await page.waitForTimeout(300);
  const acc = page.locator("section table.grid td.num input").first();
  check((await (await fetch(base + "/api/run", { method: "POST", body: JSON.stringify({ project: id, command: "contract.get", args: { key: c3.id } }) })).json()).contract.parts.length === 1, "an item added to the contract");
  await acc.fill("10");
  await acc.press("Enter");
  await page.waitForTimeout(300);
  const k3 = (await api("contract.get", { key: c3.id })).contract;
  check(k3.certificates[0].work > 0, "a certificate measured: " + k3.certificates[0].work);
  await shot("contract-certificate");
  // its PDF, from the certificate's button, and the budget's from the top bar's menu
  const pdfs = [];
  page.context().on("response", (r) => r.url().includes("/report/") && pdfs.push([r.url(), r.headers()["content-type"], r.status()]));
  await page.click("button:has-text('" + (lang === "es" ? "Certificado" : "Certificate") + "') >> nth=-1");
  await page.waitForTimeout(800);
  await page.click(".bar .menu summary");
  await page.click(".menulist button:first-child");
  await page.waitForTimeout(800);
  check(pdfs.some(([u, t, s]) => u.includes("/report/certificate") && t === "application/pdf" && s === 200), "the certificate's PDF: " + JSON.stringify(pdfs));
  check(pdfs.some(([u, t, s]) => u.includes("/report/budget") && u.includes("lang=" + lang) && t === "application/pdf" && s === 200), "the budget's PDF from the menu");
  for (const p of page.context().pages()) if (p !== page) await p.close();
  await page.click(".subtabs button:nth-child(3)");
  await page.click("button:has-text('" + (lang === "es" ? "Agregar pago" : "Add payment") + "')");
  await page.waitForTimeout(300);
  check((await api("contract.get", { key: c3.id })).contract.payments.length === 1, "a payment");
  check(errors.length === 0, "the Gantt and Contracts tabs: " + errors.join("; "));

  // the AI assistant: a request, the command it runs is logged as the AI, undo takes it back
  await page.goto(`${base}/#/p/${id}/project`);
  await page.click(".bar button:has(img[src*='light-bulb'])");
  await shot("assistant-open");
  await page.waitForSelector("aside.assistant textarea");
  await page.fill("aside.assistant textarea", "agregá arena gruesa");
  await page.press("aside.assistant textarea", "Enter");
  await page.waitForSelector("aside.assistant .said.ai .text:has-text('Listo')");
  const added = (await api("resource.list", { text: "Arena gruesa IA" })).resources ?? [];
  check(added.length === 1, "the assistant added a resource: " + JSON.stringify(added).slice(0, 200));
  check((await page.textContent("aside.assistant .steps")).includes("resource.add"), "the panel shows what it did");
  const logAi = (await api("log", { limit: 1 })).changes?.[0];
  check(logAi?.via?.startsWith("ai"), "logged as the AI: " + JSON.stringify(logAi).slice(0, 200));
  await shot("assistant");
  await page.click(".bar button:first-of-type");
  await page.waitForTimeout(300);
  check(((await api("resource.list", { text: "Arena gruesa IA" })).resources ?? []).length === 0, "undo takes the assistant's answer back");
  await page.click("aside.assistant header button:last-child");
  check(errors.length === 0, "the assistant's panel: " + errors.join("; "));

  // the design link: a sumi-designer file uploaded, a row mapped here, the budget updated
  const a1code = (await api("analysis.list", { limit: 1 })).analyses[0].code;
  const designer = JSON.stringify({ format: "designer-e", version: 42, quantities: { date: "2026-11-18 10:00:00", rows: [{ key: "Walls|Brick", group: "Muros", item: "Ladrillo", unit: "m2", qty: 50 }, { key: "Openings|V1", group: "Aberturas", item: "V1", unit: "u", qty: 4 }] }, analyses: { "Walls|Brick": [{ code: a1code, factor: 1 }] } });
  await page.goto(`${base}/#/p/${id}/budget`);
  await page.click(".toolbar.right button");
  await page.setInputFiles("section.design input[type=file]", { name: "casa.designer-proj", mimeType: "application/json", buffer: Buffer.from(designer) });
  await page.waitForSelector("section.design table.grid");
  const before = (await api("budget.list")).items.length;
  await page.fill("section.design tr.problem input", a1code + " x 2");
  await page.press("section.design tr.problem input", "Enter");
  await page.waitForTimeout(300);
  await page.click("section.design button.primary");
  await page.waitForSelector("section.design .report pre");
  const after = (await api("budget.list")).items;
  check(after.length === before + 2 && after.some((b) => b.qty === 8), "the budget from the design: " + (after.length - before) + " items");
  await shot("design");
  check(errors.length === 0, "the design link: " + errors.join("; "));

  // a change made elsewhere (another person, another window) shows by itself
  const first = (await api("budget.list")).items[0];
  await api("item.set", { key: first.id, description: "Cambiado en otra ventana" });
  await page.waitForFunction(() => [...document.querySelectorAll("table.budget input")].some((i) => i.value === "Cambiado en otra ventana"), null, { timeout: 15000 });
  check(true, "another window's change shows by itself");

  // people and roles: someone added, a role given; the project's team
  await page.goto(`${base}/#/people`);
  await page.waitForSelector(".people table.grid");
  await page.fill(".people input[type=email]", "juan@empresa.com.ar");
  await page.fill(".people .toolbar input:not([type=email])", "Juan");
  await page.click(".people .toolbar button:first-of-type");
  await page.waitForSelector(".people td:has-text('juan@empresa.com.ar')");
  const juanRow = page.locator(".people tbody tr", { hasText: "juan@empresa.com.ar" });
  await juanRow.locator(".rolechecks label", { hasText: lang === "es" ? "Presupuestista" : "Estimator" }).locator("input").click();
  await page.waitForTimeout(300);
  const juan = (await api("person.list")).people.find((k) => k.email === "juan@empresa.com.ar");
  check(juan?.roles?.includes("estimator"), "a person added and given a role: " + JSON.stringify(juan));
  await shot("people");
  await page.goto(`${base}/#/p/${id}/project`);
  await page.waitForSelector("text=" + (lang === "es" ? "Equipo del proyecto" : "Project team"));
  await page.selectOption("section:has(h2:has-text('" + (lang === "es" ? "Equipo del proyecto" : "Project team") + "')) select", { label: "Juan" });
  await page.click("section:has(h2:has-text('" + (lang === "es" ? "Equipo del proyecto" : "Project team") + "')) .toolbar button");
  await page.waitForTimeout(300);
  check((await api("member.list")).members?.[0]?.name === "Juan", "a member of the project's team");
  check(errors.length === 0, "people and roles: " + errors.join("; "));

  // the History tab shows it, with its before and after
  await page.goto(`${base}/#/p/${id}/history`);
  await page.fill("input.search", "4.01: qty");
  await page.locator("table.grid tbody tr.link").first().click();
  await page.waitForSelector(".detail pre");
  check((await page.textContent(".detail")).includes("1234.5"), "the history shows the change's before and after");
  await shot("history-detail");
  check(errors.length === 0, "no errors in the page: " + errors.join("; "));
} catch (e) {
  failures++;
  console.log("FAIL " + (e?.stack || e));
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(data, { recursive: true, force: true });
}
console.log(`GUI test: ${failures} failures`);
process.exit(failures ? 1 : 0);
