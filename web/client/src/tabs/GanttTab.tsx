// The Gantt tab (port of FGantt): a task for each budget item, by rubro, with its working days, crew, what it
// waits for and the lag; the dates and slack from the critical path; the bars (critical ones in red, the
// progress from the certificates as a dark line), each rubro condensed in one bar; and the investment curve
// by month. Every change goes through task.set (logged, undoable).

import { Fragment, useState } from "react";
import { Num, Text } from "../fields.tsx";
import { fmt, qty, tr } from "../tr.ts";
import { useCommand, useWork } from "../work.ts";

export function GanttTab() {
  const w = useWork();
  const r = useCommand(w, "schedule.get", { curve: true });
  const budget = useCommand(w, "budget.list");
  const info = useCommand(w, "info");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (!r || !budget) return <p className="muted">…</p>;
  if (r.error) return <p className="error">{r.error}</p>;
  const bad = (why: string) => w.setStatus({ text: why, error: true });
  const tasks: any[] = r.tasks;
  const byId = new Map(tasks.map((t) => [t.item, t]));
  const codeOf = (id: string) => budget.items.find((b: any) => b.id === id)?.code ?? "?";
  const length = Math.max(1, r.length);
  const span = (start: number, end: number) => ({ left: `${(start / length) * 100}%`, width: `${Math.max(0.4, ((end - start) / length) * 100)}%` });
  const set = (id: string, field: string, v: unknown) => w.run("task.set", { key: id, [field]: v });
  const suggest = () => confirm(tr("Every task's days will be worked out from its labor hours and its crew (2 people where it has none). Go on?")) && w.run("schedule.suggest");
  const late = r.length > r.available;

  return (
    <div>
      <div className="toolbar">
        <button onClick={suggest} title={tr("Every task's days from its labor hours and its crew (2 people if not set)")}>
          {tr("Suggest durations")}
        </button>
        <span className="grow" />
        <span className={"strong" + (late ? " error" : "")}>{tr("&1 working days, ends &2 (&3 available, ends &4)", qty(r.length), r.end, r.available, info?.endDate ?? "")}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="muted">{tr("The Gantt has a task for each budget item: add items in the Budget tab.")}</p>
      ) : (
        <div className="scroll wide">
          <table className="grid gantt">
            <thead>
              <tr>
                <th>{tr("Code")}</th>
                <th>{tr("Task")}</th>
                <th className="num">{tr("Days")}</th>
                <th className="num">{tr("Crew")}</th>
                <th>{tr("After")}</th>
                <th className="num">{tr("Lag")}</th>
                <th>{tr("Start")}</th>
                <th>{tr("End")}</th>
                <th className="num">{tr("Slack")}</th>
                <th className="bars" />
              </tr>
            </thead>
            <tbody>
              {budget.rubros.map((g: any) => {
                const items = budget.items.filter((b: any) => b.rubro === g.rubro);
                const ts = items.map((b: any) => byId.get(b.id)).filter(Boolean);
                const start = Math.min(...ts.map((t: any) => t.earlyStart));
                const end = Math.max(...ts.map((t: any) => t.earlyFinish));
                const total = items.reduce((f: number, b: any) => f + b.total, 0);
                const done = total > 0 ? items.reduce((f: number, b: any) => f + b.total * (byId.get(b.id)?.done ?? 0), 0) / total : 0;
                const shown = open[g.rubro] !== false;
                return (
                  <Fragment key={g.rubro}>
                    <tr className="rubro link" onClick={() => setOpen({ ...open, [g.rubro]: !shown })}>
                      <td>
                        {shown ? "▾" : "▸"} {g.rubro}
                      </td>
                      <td colSpan={8}>{g.name || tr("Rubro &1", g.rubro)}</td>
                      <td className="bars">
                        <div className="bar rubrobar" style={span(start, end)}>
                          <div className="done" style={{ width: `${done * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                    {shown &&
                      items.map((b: any) => {
                        const t = byId.get(b.id);
                        if (!t) return null;
                        return (
                          <tr key={b.id} className={t.critical ? "critical" : ""}>
                            <td>{b.code}</td>
                            <td className="desc" title={b.description}>
                              {b.description}
                            </td>
                            <td className="num">
                              <Num value={t.days} onCommit={(v) => set(b.id, "days", v)} onBad={bad} />
                            </td>
                            <td className="num">
                              <Num value={t.crew ?? 0} onCommit={(v) => set(b.id, "crew", v)} onBad={bad} />
                            </td>
                            <td>
                              <Text
                                value={(t.after ?? []).map(codeOf).join(", ")}
                                onCommit={(v) =>
                                  set(
                                    b.id,
                                    "after",
                                    v
                                      .split(/[,;\s]+/)
                                      .map((x) => x.trim())
                                      .filter(Boolean),
                                  )
                                }
                              />
                            </td>
                            <td className="num">
                              <Num value={t.lag ?? 0} onCommit={(v) => set(b.id, "lag", v)} onBad={bad} />
                            </td>
                            <td className="nowrap">{t.start}</td>
                            <td className="nowrap">{t.end}</td>
                            <td className="num">{qty(t.slack)}</td>
                            <td className="bars">
                              <div className={"bar" + (t.days === 0 ? " milestone" : "")} style={span(t.earlyStart, t.earlyFinish)} title={`${t.start} – ${t.end}`}>
                                <div className="done" style={{ width: `${(t.done ?? 0) * 100}%` }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {r.curve?.length > 0 && <Curve curve={r.curve} cur={info?.currency ?? "$"} />}
    </div>
  );
}

/** The investment curve: the price spent each month (bars) and accumulated (the line) */
function Curve({ curve, cur }: { curve: [string, number, number][]; cur: string }) {
  const total = curve[curve.length - 1][2];
  const maxMonth = Math.max(...curve.map((c) => c[1]));
  const W = 760;
  const H = 220;
  const pad = { l: 8, r: 8, t: 12, b: 28 };
  const bw = (W - pad.l - pad.r) / curve.length;
  const y = (v: number, max: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const line = curve.map((c, i) => `${pad.l + bw * (i + 1)},${y(c[2], total)}`).join(" ");
  return (
    <section className="curve">
      <h2>{tr("Investment curve: the price spent each month (each item spread over its working days)")}</h2>
      <div className="curvebox">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr("Investment curve")}>
          {curve.map((c, i) => (
            <g key={c[0]}>
              <rect x={pad.l + bw * i + bw * 0.15} width={bw * 0.7} y={y(c[1], maxMonth)} height={H - pad.b - y(c[1], maxMonth)} className="month">
                <title>{`${c[0]}: ${cur} ${fmt(c[1])}`}</title>
              </rect>
              <text x={pad.l + bw * (i + 0.5)} y={H - 10} textAnchor="middle">
                {c[0].slice(2)}
              </text>
            </g>
          ))}
          <polyline points={`${pad.l},${y(0, total)} ${line}`} className="acc" />
        </svg>
        <table className="grid">
          <thead>
            <tr>
              <th>{tr("Month")}</th>
              <th className="num">{tr("Spent")}</th>
              <th className="num">{tr("Accumulated")}</th>
              <th className="num">{tr("% accumulated")}</th>
            </tr>
          </thead>
          <tbody>
            {curve.map((c) => (
              <tr key={c[0]}>
                <td>{c[0]}</td>
                <td className="num">{fmt(c[1])}</td>
                <td className="num">{fmt(c[2])}</td>
                <td className="num">{fmt((c[2] / total) * 100, 1)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
