import { autocompletion, startCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { Language } from "../types";

interface SlashTemplate {
  id: string;
  zh: string;
  en: string;
  detailZh: string;
  detailEn: string;
  insert: string;
  cursor: number;
}

const TEMPLATES: SlashTemplate[] = [
  { id: "text", zh: "正文", en: "Text", detailZh: "普通段落", detailEn: "Plain paragraph", insert: "", cursor: 0 },
  { id: "h1", zh: "一级标题", en: "Heading 1", detailZh: "大标题", detailEn: "Large heading", insert: "# ", cursor: 2 },
  { id: "h2", zh: "二级标题", en: "Heading 2", detailZh: "中标题", detailEn: "Medium heading", insert: "## ", cursor: 3 },
  { id: "h3", zh: "三级标题", en: "Heading 3", detailZh: "小标题", detailEn: "Small heading", insert: "### ", cursor: 4 },
  { id: "bullet", zh: "项目列表", en: "Bullet list", detailZh: "无序列表", detailEn: "Unordered list", insert: "- ", cursor: 2 },
  { id: "number", zh: "编号列表", en: "Numbered list", detailZh: "有序列表", detailEn: "Ordered list", insert: "1. ", cursor: 3 },
  { id: "todo", zh: "任务", en: "To-do", detailZh: "可勾选任务", detailEn: "Task checkbox", insert: "- [ ] ", cursor: 6 },
  { id: "quote", zh: "引用", en: "Quote", detailZh: "引用段落", detailEn: "Block quote", insert: "> ", cursor: 2 },
  { id: "code", zh: "代码块", en: "Code block", detailZh: "围栏代码", detailEn: "Fenced code", insert: "```\n\n```", cursor: 4 },
  { id: "math", zh: "数学公式", en: "Math block", detailZh: "LaTeX 块公式", detailEn: "LaTeX display math", insert: "$$\n\n$$", cursor: 3 },
  { id: "divider", zh: "分隔线", en: "Divider", detailZh: "水平分隔线", detailEn: "Horizontal rule", insert: "\n---\n\n", cursor: 6 },
];

function applyTemplate(template: SlashTemplate, slashFrom: number) {
  return (view: EditorView, _completion: Completion, _from: number, to: number) => {
    view.dispatch({
      changes: { from: slashFrom, to, insert: template.insert },
      selection: { anchor: slashFrom + template.cursor },
      scrollIntoView: true,
      userEvent: "input.complete",
    });
  };
}

export function slashCommandExtension(language: Language | (() => Language)): Extension {
  const currentLanguage = () => typeof language === "function" ? language() : language;
  const source = (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.doc.sliceString(line.from, context.pos);
    const match = /^\s*\/([\p{L}\w-]*)$/u.exec(before);
    if (!match) return null;
    const slashFrom = line.from + before.lastIndexOf("/");
    return {
      from: slashFrom + 1,
      filter: true,
      options: TEMPLATES.map((template) => ({
        label: currentLanguage() === "zh" ? template.zh : template.en,
        detail: currentLanguage() === "zh" ? template.detailZh : template.detailEn,
        type: template.id === "math" ? "variable" : template.id === "divider" ? "keyword" : "text",
        apply: applyTemplate(template, slashFrom),
      })),
    };
  };
  return [
    keymap.of([{
      key: "/",
      run(view) {
        if (view.composing) return false;
        const selection = view.state.selection.main;
        if (!selection.empty) return false;
        const line = view.state.doc.lineAt(selection.head);
        if (!/^\s*$/.test(view.state.doc.sliceString(line.from, selection.head))) return false;
        view.dispatch({ changes: { from: selection.head, insert: "/" }, selection: { anchor: selection.head + 1 }, userEvent: "input.type" });
        window.setTimeout(() => startCompletion(view), 0);
        return true;
      },
    }]),
    EditorView.inputHandler.of((view, from, to, text) => {
      if (view.composing || text !== "/" || from !== to) return false;
      const line = view.state.doc.lineAt(from);
      if (!/^\s*$/.test(view.state.doc.sliceString(line.from, from))) return false;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + 1 }, userEvent: "input.type" });
      startCompletion(view);
      return true;
    }),
    autocompletion({ override: [source], activateOnTyping: true, icons: false }),
  ];
}
