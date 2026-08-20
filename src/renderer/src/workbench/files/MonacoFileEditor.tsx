import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import type { TextFilePreview } from "../../../../common/filePreview";
import { defineLoomMonacoThemes, loomMonacoThemeName } from "../monacoTheme";

function modelUri(preview: TextFilePreview) {
  const path = preview.path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return monaco.Uri.parse(`loom://${encodeURIComponent(preview.projectId)}/${encodeURIComponent(preview.root)}/${path}`);
}

export function MonacoFileEditor({ preview, onEditorReady }: { preview: TextFilePreview; onEditorReady?: (editor: monaco.editor.IStandaloneCodeEditor | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    defineLoomMonacoThemes(monaco);
    const model = monaco.editor.createModel(preview.content, preview.language, modelUri(preview));
    const editor = monaco.editor.create(containerRef.current, {
      model,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      padding: { top: 14, bottom: 18 },
      scrollBeyondLastLine: false,
      scrollBeyondLastColumn: 2,
      renderLineHighlight: "line",
      renderLineHighlightOnlyWhenFocus: false,
      selectionHighlight: false,
      occurrencesHighlight: "off",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      lineNumbersMinChars: 3,
      folding: true,
      showFoldingControls: "mouseover",
      fontFamily: "var(--font-mono)",
      fontSize: 12.5,
      lineHeight: 20,
      tabSize: 2,
      wordWrap: "on",
      scrollbar: { useShadows: false, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      accessibilitySupport: "auto",
    });
    editorRef.current = editor;
    onEditorReady?.(editor);
    monaco.editor.setTheme(loomMonacoThemeName());

    const themeObserver = new MutationObserver(() => {
      defineLoomMonacoThemes(monaco);
      monaco.editor.setTheme(loomMonacoThemeName());
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      themeObserver.disconnect();
      editorRef.current = null;
      onEditorReady?.(null);
      editor.dispose();
      model.dispose();
    };
  }, [onEditorReady, preview]);

  return <div ref={containerRef} className="loom-monaco-editor" aria-label={`预览 ${preview.name}`} />;
}
