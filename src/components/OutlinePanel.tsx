import { ListTree, X } from "lucide-react";
import type { Language } from "../types";
import type { OutlineEntry } from "../lib/documentStructure";

interface Props {
  entries: OutlineEntry[];
  language: Language;
  onClose: () => void;
  onReveal: (entry: OutlineEntry) => void;
}

export function OutlinePanel({ entries, language, onClose, onReveal }: Props) {
  const title = language === "zh" ? "本文大纲" : "Outline";
  return (
    <aside className="outline-panel" aria-label={title}>
      <header><span><ListTree size={15} />{title}</span><button type="button" aria-label={language === "zh" ? "关闭大纲" : "Close outline"} onClick={onClose}><X size={15} /></button></header>
      {entries.length > 0 ? <nav aria-label={title}>{entries.map((entry) => (
        <button
          type="button"
          key={`${entry.from}:${entry.text}`}
          className={`outline-level-${entry.level}`}
          title={entry.text}
          onClick={() => onReveal(entry)}
        >
          <span>{entry.text}</span>
        </button>
      ))}</nav> : <p>{language === "zh" ? "添加标题后，它们会出现在这里。" : "Headings will appear here as you write."}</p>}
    </aside>
  );
}
