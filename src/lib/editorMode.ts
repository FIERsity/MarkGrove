import type { ViewMode } from "../types";

const CURRENT_MODES = new Set<ViewMode>(["live", "source", "reading", "split"]);

export function normalizeViewMode(current: unknown, legacy: unknown): ViewMode {
  if (typeof current === "string" && CURRENT_MODES.has(current as ViewMode)) return current as ViewMode;
  if (legacy === "edit") return "source";
  if (legacy === "split" || legacy === "preview") return "live";
  return "live";
}
