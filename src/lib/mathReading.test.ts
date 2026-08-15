import { describe, expect, it } from "vitest";
import { prepareMarkdownForReading, prepareMarkdownForReadingWithMap } from "./mathReading";

describe("reading math dialect", () => {
  it("preserves only math accepted by the live parser", () => {
    const markdown = "Valid $x+1$. Invalid $ x$, $x $, and $$x$$.";
    expect(prepareMarkdownForReading(markdown)).toBe("Valid $x+1$. Invalid \\$ x\\$, \\$x \\$, and \\$\\$x\\$\\$.");
  });

  it("keeps exact root display math but protects nested display syntax", () => {
    const markdown = "$$\nx+y\n$$\n\n> $$\n> q\n> $$\n\n- $$\n  z\n  $$";
    expect(prepareMarkdownForReading(markdown)).toBe("$$\nx+y\n$$\n\n> \\$\\$\n> q\n> \\$\\$\n\n- \\$\\$\n  z\n  \\$\\$");
  });

  it("does not alter dollars in code or existing escapes", () => {
    const markdown = "`$ x$` and \\$5\n\n```sh\necho $HOME\n```";
    expect(prepareMarkdownForReading(markdown)).toBe(markdown);
  });

  it("protects link labels without changing destination dollars", () => {
    const markdown = "[bad $ x$](https://e.test/$id)";
    expect(prepareMarkdownForReading(markdown)).toBe("[bad \\$ x\\$](https://e.test/$id)");
  });

  it("maps transformed heading offsets back to original Markdown", () => {
    const markdown = "Bad $ x$.\n\n## Later heading";
    const prepared = prepareMarkdownForReadingWithMap(markdown);
    expect(prepared.sourceOffsetAt(prepared.content.indexOf("##"))).toBe(markdown.indexOf("##"));
  });
});
