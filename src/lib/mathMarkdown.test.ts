import { parser, GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { MathMarkdown } from "./mathMarkdown";

const mathParser = parser.configure([GFM, MathMarkdown]);

describe("MarkGrove math Markdown", () => {
  it("parses inline and display math with explicit nodes", () => {
    expect(mathParser.parse("Value $x+y$.").toString()).toContain("InlineMath(MathMark,MathText,MathMark)");
    expect(mathParser.parse("$$\nx+y\n$$\nafter").toString()).toContain("DisplayMath(MathMark,MathText,MathMark),Paragraph");
  });

  it("leaves code, currency, escaped and unfinished math as source", () => {
    expect(mathParser.parse("`$x$`").toString()).toContain("InlineCode");
    expect(mathParser.parse("money $20 and $30").toString()).not.toContain("InlineMath");
    expect(mathParser.parse("\\$x$").toString()).not.toContain("InlineMath");
    expect(mathParser.parse("$$\nunfinished\n\nafter").toString()).not.toContain("DisplayMath");
  });

  it("does not pair a rejected label dollar with a link destination dollar", () => {
    expect(mathParser.parse("[bad $ x$](https://e.test/$id)").toString()).not.toContain("InlineMath");
  });
});
