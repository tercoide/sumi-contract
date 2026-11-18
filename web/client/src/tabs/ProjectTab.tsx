// The Project tab (port of FProject): the work, its location, the client and notes; the schedule with its
// holidays, the definitions from cost to price, the contract conditions and the professionals. Every field
// changes the project through project.set (logged, undoable).

import { useState } from "react";
import { Choice, DateField, Num, Row, Text } from "../fields.tsx";
import { fmt, tr } from "../tr.ts";
import { useCommand, useWork } from "../work.ts";

interface Professional {
  role: string;
  name: string;
  registration: string;
  phone: string;
  email: string;
}

const ROLES = ["Design", "Structural engineering", "Site direction", "Builder", "Installations", "Safety and hygiene"];

export function ProjectTab() {
  const w = useWork();
  const r = useCommand(w, "project.get");
  const [holiday, setHoliday] = useState("");
  if (!r) return <p className="muted">…</p>;
  if (r.error) return <p className="error">{r.error}</p>;
  const p = r.project;
  const ch = r.choices;
  const set = (field: string, value: unknown) => w.run("project.set", { [field]: value });
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const text = (field: string, area = false) => <Text value={p[field]} area={area} onCommit={(v) => set(field, v)} />;
  const num = (field: string) => <Num value={p[field]} onCommit={(v) => set(field, v)} onBad={bad} />;
  const choice = (field: string) => <Choice value={p[field]} choices={ch[field]} onCommit={(v) => set(field, v)} />;

  const pros: Professional[] = p.professionals;
  const setPros = (list: Professional[]) => set("professionals", list);
  const setPro = (i: number, field: keyof Professional, v: string) => setPros(pros.map((x, j) => (j === i ? { ...x, [field]: v } : x)));

  const end = r.endDate as string;
  const calendarDays = Math.round((Date.parse(end) - Date.parse(p.startDate)) / 86400000) + 1;
  const between = (p.holidays as string[]).filter((d) => d >= p.startDate && d <= end).length;
  const endDay = new Date(end + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });

  return (
    <div className="columns">
      <div>
        <section>
          <h2>{tr("The work")}</h2>
          <Row label={tr("Name")}>{text("name")}</Row>
          <Row label={tr("Code")}>{text("code")}</Row>
          <Row label={tr("Type of work")}>{choice("workType")}</Row>
          <Row label={tr("Use")}>{choice("use")}</Row>
          <Row label={tr("Design")}>{text("designFile")}</Row>
        </section>
        <section>
          <h2>{tr("Location")}</h2>
          <Row label={tr("Address")}>{text("location")}</Row>
          <Row label={tr("City")}>{text("city")}</Row>
          <Row label={tr("Province")}>{text("province")}</Row>
          <Row label={tr("Cadastral parcel")}>{text("parcel")}</Row>
          <Row label={tr("Plot area (m²)")}>{num("plotArea")}</Row>
          <Row label={tr("Covered area (m²)")}>{num("coveredArea")}</Row>
          <Row label={tr("Semi-covered area (m²)")}>{num("semiCoveredArea")}</Row>
          <Row label={tr("Floors")}>{num("floors")}</Row>
        </section>
        <section>
          <h2>{tr("Client")}</h2>
          <Row label={tr("Name")}>{text("client")}</Row>
          <Row label={tr("Tax id (CUIT)")}>{text("clientTaxId")}</Row>
          <Row label={tr("Phone")}>{text("clientPhone")}</Row>
          <Row label={tr("Email")}>{text("clientEmail")}</Row>
        </section>
        <section>
          <h2>{tr("Notes")}</h2>
          {text("notes", true)}
        </section>
      </div>
      <div>
        <section>
          <h2>{tr("Schedule")}</h2>
          <Row label={tr("Start date")}>
            <DateField value={p.startDate} onCommit={(v) => set("startDate", v)} />
          </Row>
          <Row label={tr("Working days")}>{num("durationDays")}</Row>
          <Row label={tr("Working days a week")}>{num("workDaysPerWeek")}</Row>
          <Row label={tr("Hours a day")}>{num("hoursPerDay")}</Row>
          <p className="note">{tr("Ends on &1: &2 calendar days, &3 holidays in between", `${endDay} ${end}`, calendarDays, between)}</p>
          <Row label={tr("Holidays")}>
            <span className="inline">
              <input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} />
              <button disabled={!holiday} onClick={() => set("holidays", [...p.holidays, holiday])}>
                {tr("Add")}
              </button>
            </span>
          </Row>
          <div className="chips">
            {(p.holidays as string[]).map((d) => (
              <span key={d} className="chip">
                {d}
                <button title={tr("Remove")} onClick={() => set("holidays", p.holidays.filter((x: string) => x !== d))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </section>
        <section>
          <h2>{tr("Definitions: from cost to price")}</h2>
          <Row label={tr("Currency symbol")}>{text("currency")}</Row>
          <Row label={tr("General expenses %")}>{num("overheadPct")}</Row>
          <Row label={tr("Profit %")}>{num("profitPct")}</Row>
          <Row label={tr("Taxes %")}>{num("taxesPct")}</Row>
          <p className="note">{tr("Price = direct cost × &1 (&2 over cost)", fmt(r.priceFactor, 4), fmt((r.priceFactor - 1) * 100) + "%")}</p>
        </section>
        <section>
          <h2>{tr("Contract conditions")}</h2>
          <Row label={tr("Contract mode")}>{choice("contractMode")}</Row>
          <Row label={tr("Advance payment %")}>{num("advancePct")}</Row>
          <Row label={tr("Guarantee retention %")}>{num("retentionPct")}</Row>
          <Row label={tr("Certificates")}>{choice("certificatePeriod")}</Row>
          <Row label={tr("Adjustment index")}>{text("adjustmentIndex")}</Row>
          <Row label={tr("Index base month")}>{text("adjustmentBase")}</Row>
          <Row label={tr("Guarantee period (days)")}>{num("guaranteeDays")}</Row>
        </section>
        <section>
          <h2>{tr("Professionals")}</h2>
          <table className="grid edit">
            <thead>
              <tr>
                <th>{tr("Role")}</th>
                <th>{tr("Name")}</th>
                <th>{tr("Registration")}</th>
                <th>{tr("Phone")}</th>
                <th>{tr("Email")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pros.map((x, i) => (
                <tr key={i}>
                  {(["role", "name", "registration", "phone", "email"] as const).map((f) => (
                    <td key={f}>
                      <Text value={x[f]} onCommit={(v) => setPro(i, f, v)} />
                    </td>
                  ))}
                  <td>
                    <button title={tr("Remove")} onClick={() => setPros(pros.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setPros([...pros, { role: tr(ROLES[pros.length % ROLES.length]), name: "", registration: "", phone: "", email: "" }])}>{tr("Add")}</button>
        </section>
        <p className="muted small">{tr("Created &1, modified &2", r.created.slice(0, 16), r.modified.slice(0, 16))}</p>
      </div>
    </div>
  );
}
