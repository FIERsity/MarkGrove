import type {
  BlockContext, LeafBlock, LeafBlockParser, Line, MarkdownConfig,
} from "@lezer/markdown";

const DISPLAY_FENCE = /^\$\$[ \t]*$/;
const DOLLAR = 36;
const BACKSLASH = 92;
const LF = 10;
const CR = 13;
const RIGHT_BRACKET = 93;
const LEFT_PAREN = 40;

class DisplayMathParser implements LeafBlockParser {
  private readonly from: number;
  constructor(from: number) { this.from = from; }

  nextLine(context: BlockContext, line: Line, leaf: LeafBlock): boolean {
    if (!DISPLAY_FENCE.test(line.text.slice(line.pos))) return false;
    const closeFrom = context.lineStart + line.pos;
    const closeTo = closeFrom + 2;
    context.nextLine();
    context.addLeafElement(leaf, context.elt("DisplayMath", this.from, closeTo, [
      context.elt("MathMark", this.from, this.from + 2),
      context.elt("MathText", this.from + 2, closeFrom),
      context.elt("MathMark", closeFrom, closeTo),
    ]));
    return true;
  }

  finish(): boolean { return false; }
}

export const MathMarkdown: MarkdownConfig = {
  defineNodes: ["InlineMath", { name: "DisplayMath", block: true }, "MathMark", "MathText"],
  parseInline: [{
    name: "InlineMath",
    after: "InlineCode",
    parse(context, next, position) {
      if (next !== DOLLAR || context.char(position + 1) === DOLLAR || /\s/.test(context.slice(position + 1, position + 2))) return -1;
      for (let cursor = position + 1; cursor < context.end; cursor += 1) {
        const character = context.char(cursor);
        if (character === LF || character === CR) return -1;
        if (character === RIGHT_BRACKET && context.char(cursor + 1) === LEFT_PAREN) return -1;
        if (character === BACKSLASH) { cursor += 1; continue; }
        if (character !== DOLLAR) continue;
        if (cursor === position + 1 || /\s/.test(context.slice(cursor - 1, cursor)) || context.char(cursor + 1) === DOLLAR) return -1;
        return context.addElement(context.elt("InlineMath", position, cursor + 1, [
          context.elt("MathMark", position, position + 1),
          context.elt("MathText", position + 1, cursor),
          context.elt("MathMark", cursor, cursor + 1),
        ]));
      }
      return -1;
    },
  }],
  parseBlock: [{
    name: "DisplayMath",
    before: "SetextHeading",
    leaf(context, leaf) {
      return context.depth === 1 && DISPLAY_FENCE.test(leaf.content)
        ? new DisplayMathParser(leaf.start)
        : null;
    },
  }],
};
