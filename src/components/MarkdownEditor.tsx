import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import type { Theme } from "../types";

interface Props {
  value: string;
  onChange: (value: string) => void;
  theme: Theme;
  label: string;
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

export function MarkdownEditor({ value, onChange, theme, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const themeCompartment = useRef(new Compartment());
  const labelCompartment = useRef(new Compartment());
  const initialValueRef = useRef(value);
  const initialThemeRef = useRef(theme);
  const initialLabelRef = useRef(label);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        lineNumbers(), highlightSpecialChars(), history(), drawSelection(), dropCursor(),
        indentOnInput(), bracketMatching(), highlightActiveLine(), EditorView.lineWrapping,
        markdown(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        labelCompartment.current.of(EditorView.contentAttributes.of({ "aria-label": initialLabelRef.current, spellcheck: "true" })),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        themeCompartment.current.of(initialThemeRef.current === "dark" ? darkEditor : lightEditor),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
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

  return <div className="editor-host" ref={hostRef} />;
}
