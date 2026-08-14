import { describe, expect, it } from "vitest";
import { normalizeViewMode } from "./editorMode";

describe("editor mode migration", () => {
  it("keeps current v0.3 modes", () => {
    expect(normalizeViewMode("reading", "edit")).toBe("reading");
    expect(normalizeViewMode("split", "preview")).toBe("split");
  });

  it("maps old modes to the new ergonomic defaults", () => {
    expect(normalizeViewMode(null, "edit")).toBe("source");
    expect(normalizeViewMode(null, "split")).toBe("live");
    expect(normalizeViewMode(null, "preview")).toBe("live");
    expect(normalizeViewMode("unknown", "unknown")).toBe("live");
  });
});
