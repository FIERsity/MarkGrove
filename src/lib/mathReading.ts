import { GFM, parser } from "@lezer/markdown";
import { MathMarkdown } from "./mathMarkdown";

interface SourceRange { from: number; to: number }

const readingParser = parser.configure([GFM, MathMarkdown]);
const PRESERVE_DOLLARS_IN = new Set([
  "InlineMath", "DisplayMath", "InlineCode", "FencedCode", "CodeBlock",
  "URL", "Autolink", "HTMLTag", "HTMLBlock",
]);

export interface PreparedMarkdown {
  content: string;
  sourceOffsetAt: (preparedOffset: number) => number;
}

function mergedRanges(content: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  readingParser.parse(content).iterate({
    enter(node) {
      if (!PRESERVE_DOLLARS_IN.has(node.name)) return;
      ranges.push({ from: node.from, to: node.to });
      return false;
    },
  });
  ranges.sort((left, right) => left.from - right.from || right.to - left.to);
  const merged: SourceRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function alreadyEscaped(content: string, position: number): boolean {
  let slashes = 0;
  for (let index = position - 1; index >= 0 && content[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

/** Makes remark-math obey the same strict dollar rules as the live Lezer parser. */
export function prepareMarkdownForReadingWithMap(content: string): PreparedMarkdown {
  if (!content.includes("$")) return { content, sourceOffsetAt: (offset) => Math.max(0, Math.min(offset, content.length)) };
  const ranges = mergedRanges(content);
  let rangeIndex = 0;
  let result = "";
  const sourceOffsets: number[] = [];
  const append = (character: string, sourceOffset: number) => {
    sourceOffsets[result.length] = sourceOffset;
    result += character;
  };
  for (let index = 0; index < content.length; index += 1) {
    while (ranges[rangeIndex] && ranges[rangeIndex]!.to <= index) rangeIndex += 1;
    const range = ranges[rangeIndex];
    const preserved = Boolean(range && index >= range.from && index < range.to);
    const character = content[index]!;
    if (character === "$" && !preserved && !alreadyEscaped(content, index)) append("\\", index);
    append(character, index);
  }
  sourceOffsets[result.length] = content.length;
  return {
    content: result,
    sourceOffsetAt(preparedOffset) {
      const safeOffset = Math.max(0, Math.min(preparedOffset, result.length));
      return sourceOffsets[safeOffset] ?? content.length;
    },
  };
}

export function prepareMarkdownForReading(content: string): string {
  return prepareMarkdownForReadingWithMap(content).content;
}
