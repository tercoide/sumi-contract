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

const server = spawn(process.execPath, ["dist/src/server/main.js"], { cwd: web, env: { ...process.env, SUMI_DATA: data, SUMI_PORT: String(port), SUMI_USER: "Tester" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok) => server.stdout.once("data", ok));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, locale: lang === "es" ? "es-AR" : "en-US" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, name + ".png"), fullPage: true }));
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

  // the History tab shows it, with its before and after
  await page.goto(`${base}/#/p/${id}/history`);
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
