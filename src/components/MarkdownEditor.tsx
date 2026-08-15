import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import type { EditorAppearance, Language, Theme } from "../types";
import { buildOutline, type OutlineEntry } from "../lib/documentStructure";
import { MathMarkdown } from "../lib/mathMarkdown";
import { livePreviewExtension } from "./livePreviewExtension";
import { slashCommandExtension } from "./slashCommandExtension";

interface Props {
  value: string;
  onChange: (value: string) => void;
  theme: Theme;
  label: string;
  appearance: EditorAppearance;
  language: Language;
  visible: boolean;
  onOutlineChange?: (entries: OutlineEntry[]) => void;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  revealPosition: (position: number) => void;
}

const darkEditor = EditorView.theme({
  "&": { backgroundColor: "#18211d", color: "#e7e7df" },
  ".cm-content": { caretColor: "#d6b66f" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#d6b66f" },
  ".cm-gutters": { backgroundColor: "#18211d", color: "#718078", border: "none" },
  ".cm-activeLine": { backgroundColor: "#ffffff0a" },
  ".cm-activeLineGutter": { backgroundColor: "#ffffff0a" },
  "&.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "#355c4a88" },
}, { dark: true });

const lightEditor = EditorView.theme({
  "&": { backgroundColor: "#fffdf7", color: "#25302a" },
  ".cm-content": { caretColor: "#2f5a45" },
  ".cm-gutters": { backgroundColor: "#fffdf7", color: "#a19d91", border: "none" },
  ".cm-activeLine": { backgroundColor: "#315b4510" },
  ".cm-activeLineGutter": { backgroundColor: "#315b4510" },
  "&.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "#bfd4c5aa" },
});

function appearanceExtensions(appearance: EditorAppearance, language: Language): Extension {
  return appearance === "live" ? livePreviewExtension(language) : [lineNumbers(), highlightActiveLine()];
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { value, onChange, theme, label, appearance, language, visible, onOutlineChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onOutlineChangeRef = useRef(onOutlineChange);
  const themeCompartment = useRef(new Compartment());
  const labelCompartment = useRef(new Compartment());
  const appearanceCompartment = useRef(new Compartment());
  const initialValueRef = useRef(value);
  const initialThemeRef = useRef(theme);
  const initialLabelRef = useRef(label);
  const initialAppearanceRef = useRef(appearance);
  const initialLanguageRef = useRef(language);
  const languageRef = useRef(language);
  onChangeRef.current = onChange;
  onOutlineChangeRef.current = onOutlineChange;
  languageRef.current = language;

  useImperativeHandle(ref, () => ({
    focus() { viewRef.current?.focus(); },
    revealPosition(position) {
      const view = viewRef.current;
      if (!view) return;
      const safePosition = Math.max(0, Math.min(position, view.state.doc.length));
      view.dispatch({ selection: { anchor: safePosition }, scrollIntoView: true });
      view.focus();
    },
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        highlightSpecialChars(), history(), drawSelection(), dropCursor(),
        indentOnInput(), bracketMatching(), EditorView.lineWrapping,
        markdown({ extensions: [GFM, MathMarkdown] }), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        slashCommandExtension(() => languageRef.current),
        labelCompartment.current.of(EditorView.contentAttributes.of({ "aria-label": initialLabelRef.current, spellcheck: "true" })),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
            onOutlineChangeRef.current?.(buildOutline(update.state));
          }
        }),
        themeCompartment.current.of(initialThemeRef.current === "dark" ? darkEditor : lightEditor),
        appearanceCompartment.current.of(appearanceExtensions(initialAppearanceRef.current, initialLanguageRef.current)),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    onOutlineChangeRef.current?.(buildOutline(state));
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(theme === "dark" ? darkEditor : lightEditor),
    });
  }, [theme]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: labelCompartment.current.reconfigure(EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "true" })),
    });
  }, [label]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: appearanceCompartment.current.reconfigure(appearanceExtensions(appearance, language)),
    });
  }, [appearance, language]);

  useEffect(() => {
    if (visible) viewRef.current?.requestMeasure();
  }, [visible]);

  return <div className={`editor-host appearance-${appearance}`} ref={hostRef} />;
});
