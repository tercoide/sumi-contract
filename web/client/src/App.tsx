// The program: the list of projects, or a project with the top bar and its tabs (as the Gambas version's
// main window). The address says which: #/ or #/p/<project id>/<tab>.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api.ts";
import { Ctx, useCommand, type Work } from "./work.ts";
import { lang, setLang, tr } from "./tr.ts";
import { ProjectTab } from "./tabs/ProjectTab.tsx";
import { BudgetTab } from "./tabs/BudgetTab.tsx";
import { HistoryTab } from "./tabs/HistoryTab.tsx";
import { PricingTab } from "./tabs/PricingTab.tsx";
import { GanttTab } from "./tabs/GanttTab.tsx";
import { ContractsTab } from "./tabs/ContractsTab.tsx";

const TABS = [
  { id: "project", label: () => tr("Project") },
  { id: "budget", label: () => tr("Budget") },
  { id: "gantt", label: () => tr("Gantt") },
  { id: "pricing", label: () => tr("Pricing") },
  { id: "contracts", label: () => tr("Contracts") },
  { id: "history", label: () => tr("History") },
];

function useHash(): string[] {
  const read = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [h, setH] = useState(read);
  useEffect(() => {
    const on = () => setH(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return h;
}

export function App() {
  const h = useHash();
  const [me, setMe] = useState<api.Result | null>(null);
  useEffect(() => {
    api.me().then(setMe);
  }, []);
  if (!me) return null;
  if (me.login && !me.person) return <SignIn />;
  return (
    <MeCtx.Provider value={me}>{h[0] === "p" && h[1] ? <Workspace id={h[1]} tab={h[2] || "project"} /> : <Projects />}</MeCtx.Provider>
  );
}

const MeCtx = createContext<api.Result>({});

// SIGNING IN (with the company's Google account, when the server has the keys)

function SignIn() {
  useEffect(() => {
    document.title = "sumi-contract";
  }, []);
  return (
    <div className="page">
      <header className="bar">
        <span className="brand">sumi-contract</span>
        <span className="grow" />
        <LangSwitch />
      </header>
      <main className="signin">
        <h1>sumi-contract</h1>
        <p>{tr("Sign in with your company's Google account.")}</p>
        <a className="button google" href={api.loginUrl()}>
          {tr("Sign in with Google")}
        </a>
      </main>
    </div>
  );
}

/** Who is working, and signing out, at the end of the top bar */
function You() {
  const me = useContext(MeCtx);
  if (!me.person) return null;
  return (
    <>
      <span className="you" title={me.person.email}>
        {me.person.picture && <img src={me.person.picture} alt="" referrerPolicy="no-referrer" />}
        {me.person.name}
      </span>
      {me.login && (
        <button onClick={() => api.logout()} title={tr("Sign out")}>
          <Icon name="application-exit" />
        </button>
      )}
    </>
  );
}

const REPORTS = [
  { kind: "budget", label: () => tr("Budget") },
  { kind: "summary", label: () => tr("Budget summary") },
  { kind: "analyses", label: () => tr("Unit price analyses") },
  { kind: "gantt", label: () => tr("Gantt") },
];

/** The PDF reports of the project */
function PdfMenu({ id, setStatus }: { id: string; setStatus: Work["setStatus"] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && ref.current.removeAttribute("open");
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, []);
  const open = async (kind: string) => {
    ref.current?.removeAttribute("open");
    const r = await api.openReport(id, { kind });
    setStatus(r.error ? { text: r.error, error: true } : { text: tr("&1: &2 pages", r.name, r.pages), error: false });
  };
  return (
    <details className="menu" ref={ref}>
      <summary className="button" title={tr("The reports, in PDF")}>
        <Icon name="document-print" /> PDF
      </summary>
      <div className="menulist">
        {REPORTS.map((x) => (
          <button key={x.kind} onClick={() => open(x.kind)}>
            {x.label()}
          </button>
        ))}
        <p className="muted">{tr("A certificate's PDF is in the Contracts tab.")}</p>
      </div>
    </details>
  );
}

function Icon({ name }: { name: string }) {
  return <img className="icon" src={`/icons/${name}.svg`} alt="" />;
}

function LangSwitch() {
  return (
    <select className="lang" value={lang} onChange={(e) => setLang(e.target.value)} title={tr("Language")}>
      <option value="es">Español</option>
      <option value="en">English</option>
    </select>
  );
}

// THE PROJECTS

function Projects() {
  const [list, setList] = useState<api.Result[] | null>(null);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "sumi-contract";
    api.listProjects().then((r) => setList(r.projects ?? []));
  }, []);

  const create = async () => {
    const r = await api.newProject();
    if (r.id) location.hash = `#/p/${r.id}/project`;
    else setError(r.error);
  };
  const open = async (f: File | undefined) => {
    if (!f) return;
    const r = await api.importProject(await f.text());
    if (r.id) location.hash = `#/p/${r.id}/project`;
    else setError(r.error);
  };

  return (
    <div className="page">
      <header className="bar">
        <span className="brand">sumi-contract</span>
        <button onClick={create}>
          <Icon name="document-new" /> {tr("New")}
        </button>
        <button onClick={() => file.current?.click()} title={tr("A .contract-proj file, from here or from the desktop version")}>
          <Icon name="document-import" /> {tr("Open a file")}
        </button>
        <input ref={file} type="file" accept=".contract-proj,application/json" hidden onChange={(e) => open(e.target.files?.[0])} />
        <span className="grow" />
        <LangSwitch />
        <You />
      </header>
      {error && <p className="error">{error}</p>}
      <main className="projects">
        <h1>{tr("Projects")}</h1>
        {list === null ? (
          <p className="muted">…</p>
        ) : list.length === 0 ? (
          <p className="muted">{tr("There are no projects yet: make a new one, or open a file.")}</p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>{tr("Work")}</th>
                <th>{tr("Client")}</th>
                <th>{tr("Location")}</th>
                <th>{tr("Changed")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="link" onClick={() => (location.hash = `#/p/${p.id}/project`)}>
                  <td>{p.name || <span className="muted">{tr("Untitled")}</span>}</td>
                  <td>{p.client}</td>
                  <td>{p.location}</td>
                  <td>{p.modified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}

// A PROJECT

function Workspace({ id, tab }: { id: string; tab: string }) {
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<{ text: string; error: boolean }>({ text: "", error: false });

  const run = useCallback(
    async (command: string, args: Record<string, unknown> = {}) => {
      const r = await api.run(id, command, args);
      if (r.error) setStatus({ text: r.error, error: true });
      else if (r.summary) setStatus({ text: r.summary, error: false });
      if (!r.error) setVersion((v) => v + 1);
      return r;
    },
    [id],
  );
  const work: Work = useMemo(() => ({ id, version, run, setStatus }), [id, version, run]);
  const info = useCommand(work, "info");

  useEffect(() => {
    document.title = (info?.name || tr("Untitled")) + " — sumi-contract";
  }, [info?.name]);

  return (
    <Ctx.Provider value={work}>
      <div className="page">
        <header className="bar">
          <a className="brand" href="#/" title={tr("Projects")}>
            sumi-contract
          </a>
          <span className="title">{info?.name || tr("Untitled")}</span>
          <button onClick={() => run("undo")} title={tr("Undo your last change")}>
            <Icon name="edit-undo" /> {tr("Undo")}
          </button>
          <button onClick={() => run("redo")} title={tr("Redo what you undid")}>
            <Icon name="edit-redo" /> {tr("Redo")}
          </button>
          <a className="button" href={api.fileUrl(id)} title={tr("The .contract-proj file, also for the desktop version")}>
            <Icon name="document-export" /> {tr("Download")}
          </a>
          <PdfMenu id={id} setStatus={setStatus} />
          <span className="grow" />
          <LangSwitch />
          <You />
        </header>
        <nav className="tabs">
          {TABS.map((t) => (
            <a key={t.id} href={`#/p/${id}/${t.id}`} className={t.id === tab ? "on" : ""}>
              {t.label()}
            </a>
          ))}
        </nav>
        <main className="tab">
          {tab === "project" && <ProjectTab />}
          {tab === "budget" && <BudgetTab />}
          {tab === "history" && <HistoryTab />}
          {tab === "pricing" && <PricingTab />}
          {tab === "gantt" && <GanttTab />}
          {tab === "contracts" && <ContractsTab />}
        </main>
        <footer className={"status" + (status.error ? " error" : "")}>
          {status.text || (info ? tr("&1 items, &2 changes in the log", info.budgetItems, info.changes) : "")}
        </footer>
      </div>
    </Ctx.Provider>
  );
}
