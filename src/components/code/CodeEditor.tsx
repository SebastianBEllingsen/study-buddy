"use client";

import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { defaultHighlightStyle, LanguageDescription, syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { CODE_LANGUAGE_NAMES, type CodeLanguage } from "@/lib/code/types";

// Follows the app's own colours (like NoteEditor's theme), so it fits every
// app theme instead of CodeMirror's built-in light one.
const editorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--card)", color: "var(--foreground)", fontSize: "0.875rem" },
  ".cm-content": { fontFamily: "var(--font-mono, ui-monospace, monospace)", caretColor: "var(--foreground)" },
  ".cm-gutters": { backgroundColor: "var(--muted)", color: "var(--muted-foreground)", border: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--muted) 50%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklch, var(--primary) 25%, transparent) !important",
  },
});

const loaded = new Map<CodeLanguage, LanguageSupport>();

export function CodeEditor({
  language,
  value,
  onChange,
  readOnly = false,
  minHeight = "12rem",
}: {
  language: CodeLanguage;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  minHeight?: string;
}) {
  const [support, setSupport] = useState<LanguageSupport | null>(() => loaded.get(language) ?? null);

  useEffect(() => {
    if (loaded.has(language)) return;
    const description = LanguageDescription.matchLanguageName(languages, CODE_LANGUAGE_NAMES[language]);
    void description?.load().then((s) => {
      loaded.set(language, s);
      setSupport(s);
    });
  }, [language]);

  const extensions = useMemo(
    () => [editorTheme, syntaxHighlighting(defaultHighlightStyle, { fallback: true }), ...(support ? [support] : [])],
    [support]
  );

  return (
    <div className="overflow-hidden rounded-lg border">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        readOnly={readOnly}
        editable={!readOnly}
        theme="none"
        minHeight={minHeight}
        aria-label={`${CODE_LANGUAGE_NAMES[language]} code`}
        basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly, autocompletion: true, tabSize: 4 }}
      />
    </div>
  );
}
