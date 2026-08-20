import { AlertTriangle, FileCode2, FileImage, LoaderCircle } from "lucide-react";
import { lazy, Suspense } from "react";
import { useState } from "react";
import type { editor } from "monaco-editor";
import type { FilePreviewResult } from "../../../../common/filePreview";
import { useI18n } from "../../i18n/I18nProvider";

const MonacoFileEditor = lazy(() => import("./MonacoFileEditor").then((module) => ({ default: module.MonacoFileEditor })));

export function FilePreviewPane({ preview, loading, error }: { preview: FilePreviewResult | null; loading: boolean; error: string | null }) {
  const { t } = useI18n();
  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
  if (loading) return <div className="files-empty" role="status"><LoaderCircle className="animate-spin" size={16} />{t("files.reading")}</div>;
  if (error) return <div className="files-empty files-empty--error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>;
  if (!preview) return <div className="files-empty"><FileCode2 size={18} /><span>{t("files.selectToPreview")}</span></div>;
  if (preview.kind === "text") return <div className="files-preview-content flex h-full min-h-0 min-w-0 flex-col bg-loom-code-bg"><div className="files-preview-meta flex min-h-9 flex-none items-center justify-between gap-loom-1 border-b border-loom-code-border bg-loom-surface px-loom-2 py-loom-1"><span className="font-loom-mono text-[10px] tracking-[0.02em] text-loom-muted">{preview.language}{preview.truncated ? ` · ${t("files.truncated")}` : ""}</span><span className="files-preview-actions inline-flex gap-loom-1"><button type="button" className="files-preview-action cursor-pointer rounded-loom-sm border border-transparent bg-transparent px-loom-1 py-[3px] font-loom-ui text-[11px] text-loom-muted transition-colors duration-150 ease-loom hover:bg-loom-surface-2 hover:text-loom-text focus-visible:outline focus-visible:outline-loom-accent disabled:cursor-default disabled:opacity-45" aria-label={t("files.copyContent")} onClick={() => void navigator.clipboard?.writeText(preview.content)}>{t("common.copy")}</button><button type="button" className="files-preview-action cursor-pointer rounded-loom-sm border border-transparent bg-transparent px-loom-1 py-[3px] font-loom-ui text-[11px] text-loom-muted transition-colors duration-150 ease-loom hover:bg-loom-surface-2 hover:text-loom-text focus-visible:outline focus-visible:outline-loom-accent disabled:cursor-default disabled:opacity-45" aria-label={t("files.findContent")} disabled={!editorInstance} onClick={() => void editorInstance?.getAction("actions.find")?.run()}>{t("common.search")}</button><button type="button" className="files-preview-action cursor-pointer rounded-loom-sm border border-transparent bg-transparent px-loom-1 py-[3px] font-loom-ui text-[11px] text-loom-muted transition-colors duration-150 ease-loom hover:bg-loom-surface-2 hover:text-loom-text focus-visible:outline focus-visible:outline-loom-accent disabled:cursor-default disabled:opacity-45" aria-label={t("files.foldCode")} disabled={!editorInstance} onClick={() => void editorInstance?.getAction("editor.foldAll")?.run()}>{t("common.fold")}</button></span></div><Suspense fallback={<div className="files-empty" role="status"><LoaderCircle className="animate-spin" size={16} />{t("files.loadingEditor")}</div>}><MonacoFileEditor preview={preview} onEditorReady={setEditorInstance} /></Suspense></div>;
  if (preview.kind === "image") return <div className="files-image-preview"><FileImage size={16} /><img src={preview.dataUrl} alt={preview.name} /></div>;
  return <div className="files-empty"><AlertTriangle size={18} /><span>{preview.reason === "too-large" ? t("files.tooLargePreview") : t("files.binaryPreview")}</span></div>;
}
