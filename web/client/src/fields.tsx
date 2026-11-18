// Fields that change the project through a command when the person leaves them (or presses Enter), as the
// Gambas tabs do: what is typed shows at once, the command logs it (typing in one field again is one change).

import { useEffect, useState, type ReactNode } from "react";
import { parseNum, qty, tr } from "./tr.ts";

export function Row({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={"row" + (wide ? " wide" : "")}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** A text; onCommit when it changed */
export function Text({ value, onCommit, area, placeholder }: { value: string; onCommit: (v: string) => void; area?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const commit = () => v !== (value ?? "") && onCommit(v);
  if (area) return <textarea value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} rows={4} />;
  return <input value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

/** A number typed the person's way; a text that isn't one is said and not sent */
export function Num({ value, onCommit, onBad, width }: { value: number; onCommit: (v: number) => void; onBad?: (why: string) => void; width?: string }) {
  const [v, setV] = useState(qty(value));
  useEffect(() => setV(qty(value)), [value]);
  const commit = () => {
    const n = parseNum(v);
    if (n === null) {
      onBad?.(tr("&1 is not a number.", v));
      setV(qty(value));
    } else if (n !== value) onCommit(n);
    else setV(qty(value));
  };
  return <input className="num" style={{ width }} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

/** One of a list: kept in English, shown translated (as the Gambas combos) */
export function Choice({ value, choices, onCommit }: { value: string; choices: string[]; onCommit: (v: string) => void }) {
  const list = choices.includes(value) || !value ? choices : [value, ...choices];
  return (
    <select value={value} onChange={(e) => onCommit(e.target.value)}>
      {list.map((c) => (
        <option key={c} value={c}>
          {tr(c)}
        </option>
      ))}
    </select>
  );
}

export function DateField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  return <input type="date" value={value} onChange={(e) => e.target.value && e.target.value !== value && onCommit(e.target.value)} />;
}
