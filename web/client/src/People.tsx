// The company's people and their roles (#/people): who may sign in, and what each may change in every project.
// A project's own team (roles there only) is in its Project tab. Only administrators change this; every change
// is in the company's log and can be undone.

import { useEffect, useState } from "react";
import * as api from "./api.ts";
import { Text } from "./fields.tsx";
import { tr } from "./tr.ts";

export function useRoles(): api.Result | null {
  const [r, setR] = useState<api.Result | null>(null);
  useEffect(() => {
    api.run("", "role.list").then(setR);
  }, []);
  return r;
}

/** The roles as checkboxes */
export function RoleChecks({ roles, all, onChange }: { roles: string[]; all: api.Result[]; onChange: (roles: string[]) => void }) {
  return (
    <span className="rolechecks">
      {all.map((r) => (
        <label key={r.id} title={r.rights.length ? r.rights.join(", ") : ""}>
          <input type="checkbox" checked={roles.includes(r.id)} onChange={(e) => onChange(e.target.checked ? [...roles, r.id] : roles.filter((x) => x !== r.id))} />
          {r.name}
        </label>
      ))}
    </span>
  );
}

export function People({ bar }: { bar: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const [people, setPeople] = useState<api.Result[] | null>(null);
  const [status, setStatus] = useState({ text: "", error: false });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const roles = useRoles();

  useEffect(() => {
    document.title = tr("People and roles") + " — sumi-contract";
    api.run("", "person.list").then((r) => setPeople(r.people ?? []));
  }, [version]);

  const run = async (command: string, args: Record<string, unknown>) => {
    const r = await api.run("", command, args);
    setStatus(r.error ? { text: r.error, error: true } : { text: r.summary ?? "", error: false });
    setVersion((v) => v + 1);
    return r;
  };
  const add = async () => {
    const r = await run("person.add", { email, name });
    if (!r.error) {
      setEmail("");
      setName("");
    }
  };

  return (
    <div className="page">
      {bar}
      <main className="projects people">
        <h1>{tr("People and roles")}</h1>
        <p className="muted">
          {tr("The company's people: who may sign in with Google, and what each may change in every project. Everyone can look at everything. A project can give someone more roles, in its Project tab.")}
        </p>
        {people === null || !roles ? (
          <p className="muted">…</p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>{tr("Name")}</th>
                <th>{tr("Google account")}</th>
                <th>{tr("Roles in every project")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((k) => (
                <tr key={k.id}>
                  <td>
                    <Text value={k.name} onCommit={(v) => run("person.set", { key: k.id, name: v })} />
                  </td>
                  <td>{k.email || <span className="muted">{tr("(this computer)")}</span>}</td>
                  <td>
                    <RoleChecks roles={k.roles} all={roles.roles} onChange={(r) => run("person.set", { key: k.id, roles: r })} />
                  </td>
                  <td className="actions">
                    <button title={tr("Delete")} onClick={() => confirm(tr("Delete &1? Their changes stay in the logs.", k.name || k.email)) && run("person.delete", { key: k.id })}>
                      <img className="icon" src="/icons/list-remove.svg" alt="" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="toolbar">
          <input type="email" placeholder={tr("their Google address")} value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder={tr("Name")} value={name} onChange={(e) => setName(e.target.value)} />
          <button disabled={!email.trim()} onClick={add}>
            <img className="icon" src="/icons/list-add.svg" alt="" /> {tr("Add")}
          </button>
          <button onClick={() => run("undo", {})} title={tr("Undo your last change")}>
            <img className="icon" src="/icons/edit-undo.svg" alt="" /> {tr("Undo")}
          </button>
        </div>
        {status.text && <p className={status.error ? "error" : "muted"}>{status.text}</p>}
        {roles && (
          <section>
            <h2>{tr("The roles")}</h2>
            <table className="grid">
              <tbody>
                {roles.roles.map((r: api.Result) => (
                  <tr key={r.id}>
                    <td className="strong">{r.name}</td>
                    <td>{r.rights.length ? r.rights.map((x: string) => roles.rights[x].name).join(", ") : tr("Only looks")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="muted small">
              {Object.entries(roles.rights as Record<string, api.Result>).map(([k, v]) => (
                <li key={k}>
                  <strong>{v.name}</strong>: {v.text}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
