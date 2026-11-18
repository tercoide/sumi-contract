// What every tab gets: the open project, a way to run commands, and a version that grows after each change
// (the tabs read again what they show, as the Gambas tabs' Reload).

import { createContext, useContext, useEffect, useState } from "react";
import * as api from "./api.ts";

export interface Work {
  id: string;
  version: number;
  run: (command: string, args?: Record<string, unknown>) => Promise<api.Result>;
  setStatus: (s: { text: string; error: boolean }) => void;
}

export const Ctx = createContext<Work>(null!);

export const useWork = () => useContext(Ctx);

/** The result of a command that only reads, run again after every change; null until it arrives */
export function useCommand(w: Work, command: string, args: Record<string, unknown> = {}): api.Result | null {
  const [r, setR] = useState<api.Result | null>(null);
  const key = JSON.stringify(args);
  useEffect(() => {
    let live = true;
    api.run(w.id, command, args).then((x) => live && setR(x));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.id, w.version, command, key]);
  return r;
}
