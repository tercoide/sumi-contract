// Choosing a resource or an analysis by typing part of its code or name (port of FPick)

import { useState } from "react";
import { qty, tr } from "../../tr.ts";
import { useCommand, useWork } from "../../work.ts";

export function Pick({ what, kind, placeholder, onPick }: { what: "resource" | "analysis"; kind?: string; placeholder: string; onPick: (item: Record<string, any>) => void }) {
  const w = useWork();
  const [text, setText] = useState("");
  const list = useCommand(w, what === "resource" ? "resource.list" : "analysis.list", { text, kind, limit: 15 });
  const items: any[] = (what === "resource" ? list?.resources : list?.analyses) ?? [];
  return (
    <span className="pick">
      <input className="search" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setText("")} />
      {text && (
        <div className="dropdown">
          {items.length === 0 && <div className="muted">{tr("Nothing has that.")}</div>}
          {items.map((x) => (
            <div
              key={x.id}
              className="link"
              onClick={() => {
                onPick(x);
                setText("");
              }}
            >
              <b>{x.code}</b> {x.name}{" "}
              <span className="muted">
                ({x.unit}, {qty(x.unitPrice ?? x.direct)})
              </span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
