import { describe, expect, it } from "vitest";
import { safeExternalLink } from "./renderPolicy";

describe("shared Markdown render policy", () => {
  it("allows deliberate web and mail links", () => {
    expect(safeExternalLink("/guide", "https://example.test/note")).toBe("https://example.test/guide");
    expect(safeExternalLink("mailto:writer@example.test")).toBe("mailto:writer@example.test");
  });

  it("blocks executable and malformed protocols", () => {
    expect(safeExternalLink("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalLink("data:text/html,unsafe")).toBeUndefined();
  });
});
