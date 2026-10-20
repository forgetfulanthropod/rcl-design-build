import { createContext, useContext } from "react";
import type { loadDesk } from "@/lib/server/fns";

export type DeskResult = Awaited<ReturnType<typeof loadDesk>>;
export type ReadyDesk = Extract<DeskResult, { needsSetup: false }>;

export type DeskContextValue = {
  ready: ReadyDesk;
  commit: (work: Promise<DeskResult>) => Promise<void>;
  /** The record shown in the current view, for the page title ("RFI 004"). */
  setRecordTitle: (title: string) => void;
  /** Sharing settings saved something: refresh the header review badge (spec 06). */
  sharingChanged: () => void;
};
export const DeskContext = createContext<DeskContextValue | null>(null);

/** The loaded desk, for the per-view routes rendered inside the shell (spec 05 · F1). */
export function useDesk(): DeskContextValue {
  const value = useContext(DeskContext);
  if (!value) throw new Error("useDesk outside the desk shell");
  return value;
}
