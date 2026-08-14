import { parse, stringify } from "yaml";
import type { NoteRecord } from "../types";

export const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

export interface ParsedMarkdown {
  title: string;
  content: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
}

function filenameTitle(filename: string): string {
  return filename.replace(/\.(?:md|markdown|txt)$/i, "").trim() || "Untitled note";
}

export function extractHeadingTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+?)\s*$/m);
  return match?.[1]?.replace(/[*_`]/g, "").trim() || null;
}

export function parseMarkdown(filename: string, source: string): ParsedMarkdown {
  const normalized = source.replace(/^\uFEFF/, "");
  const frontmatterMatch = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let content = normalized;
  let metadata: Record<string, unknown> = {};
  if (frontmatterMatch) {
    try {
      const parsed = parse(frontmatterMatch[1] ?? "");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
        content = normalized.slice(frontmatterMatch[0].length).replace(/^\r?\n/, "");
      }
    } catch {
      metadata = {};
    }
  }

  const rawTags = metadata.tags;
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((tag): tag is string => typeof tag === "string")
    : typeof rawTags === "string"
      ? rawTags.split(/[,\s]+/)
      : [];
  const title = typeof metadata.title === "string" && metadata.title.trim()
    ? metadata.title.trim()
    : extractHeadingTitle(content) ?? filenameTitle(filename);
  const { title: _title, tags: _tags, ...frontmatter } = metadata;
  void _title;
  void _tags;
  return { title, content, tags, frontmatter };
}

export function serializeMarkdown(note: Pick<NoteRecord, "title" | "content" | "tags" | "frontmatter">): string {
  const metadata: Record<string, unknown> = {
    ...note.frontmatter,
    title: note.title,
  };
  if (note.tags.length > 0) metadata.tags = note.tags;
  const yaml = stringify(metadata, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${note.content.replace(/^\n+/, "")}`;
}

export function safeFilename(title: string): string {
  const withoutControls = [...title.normalize("NFC")]
    .map((character) => character.charCodeAt(0) < 32 ? "-" : character)
    .join("");
  const cleaned = withoutControls
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 96)
    .trim();
  const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(cleaned);
  return `${reserved ? `_${cleaned}` : cleaned || "untitled"}.md`;
}

export function countCharacters(content: string): number {
  return [...content.trim()].length;
}
