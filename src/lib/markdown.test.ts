import { describe, expect, it } from "vitest";
import { parseMarkdown, safeFilename, serializeMarkdown } from "./markdown";

describe("Markdown portability", () => {
  it("imports title, tags, and unknown frontmatter without losing body text", () => {
    const parsed = parseMarkdown("fallback.md", `---\ntitle: Garden plan\ntags:\n  - ideas\n  - home\nauthor: Lin\n---\n\n# Body title\n\nKeep this.`);
    expect(parsed.title).toBe("Garden plan");
    expect(parsed.tags).toEqual(["ideas", "home"]);
    expect(parsed.frontmatter).toEqual({ author: "Lin" });
    expect(parsed.content).toContain("Keep this.");
  });

  it("round-trips app metadata as readable Markdown frontmatter", () => {
    const source = serializeMarkdown({
      title: "Field notes",
      content: "# First day\n\nA portable note.",
      tags: ["travel", "draft"],
      frontmatter: { author: "Me" },
    });
    const parsed = parseMarkdown("field-notes.md", source);
    expect(parsed.title).toBe("Field notes");
    expect(parsed.tags).toEqual(["travel", "draft"]);
    expect(parsed.frontmatter).toEqual({ author: "Me" });
    expect(parsed.content).toBe("# First day\n\nA portable note.");
  });

  it("sanitizes export filenames and Windows reserved names", () => {
    expect(safeFilename("../plan: Q3? ")).toBe("-plan- Q3-.md");
    expect(safeFilename("CON")).toBe("_CON.md");
  });
});
