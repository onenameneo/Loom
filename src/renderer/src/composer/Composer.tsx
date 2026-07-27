import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Square, X } from "lucide-react";
import { IconSend } from "../icons";
import type { CmdCtx } from "./commands";
import { CommandMenu } from "./CommandMenu";
import { SlashPalette, type SlashPaletteHandle } from "./SlashPalette";

export type ComposerImage = { data: string; mimeType: string };

export function Composer({
  nodeId,
  value,
  onChange,
  busy,
  placeholder,
  mount,
  canRegenerate,
  budgetLine,
  topAccessory,
  onSubmit,
  onStop,
  onToggleMount,
  onOpenPersona,
  onClearNode,
  onRegenerate,
  onSetModel,
}: {
  nodeId: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  placeholder: string;
  mount: boolean;
  canRegenerate: boolean;
  budgetLine?: string;
  topAccessory?: ReactNode;
  onSubmit: (text: string, images: ComposerImage[]) => void;
  onStop: () => void;
  onToggleMount: (on: boolean) => void;
  onOpenPersona: () => void;
  onClearNode: () => void;
  onRegenerate: () => void;
  onSetModel: (model: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const slashRef = useRef<SlashPaletteHandle>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [modelOptions, setModelOptions] = useState<{ id: string; name: string }[]>([]);
  const composingRef = useRef(false);

  const insertText = useCallback(
    (text: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;
      const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => {
        const target = textareaRef.current;
        if (!target) return;
        const innerOffset = text === "\n```\n\n```\n" ? 5 : text.length;
        const pos = start + innerOffset;
        target.focus();
        target.setSelectionRange(pos, pos);
      });
    },
    [onChange, value],
  );

  const attachImage = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const ctx = useMemo<CmdCtx>(
    () => ({
      nodeId,
      insertText,
      attachImage,
      toggleMount: onToggleMount,
      openPersona: onOpenPersona,
      clearNode: onClearNode,
      regenerate: onRegenerate,
      setModel: onSetModel,
      getState: () => ({ mount, canRegenerate }),
    }),
    [attachImage, canRegenerate, insertText, mount, nodeId, onClearNode, onOpenPersona, onRegenerate, onSetModel, onToggleMount],
  );

  useEffect(() => {
    if (!slashOpen || !value.startsWith("/model")) return;
    let alive = true;
    window.api?.canvas.models().then((items) => {
      if (alive) setModelOptions(items);
    });
    return () => {
      alive = false;
    };
  }, [slashOpen, value]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<ComposerImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
              const result = String(reader.result ?? "");
              resolve({ mimeType: file.type || "image/png", data: result.replace(/^data:[^;]+;base64,/, "") });
            };
            reader.readAsDataURL(file);
          }),
      ),
    );
    setImages((current) => current.concat(next));
  }

  function submit() {
    const text = value.trim();
    if (busy || (!text && images.length === 0)) return;
    onSubmit(text, images);
    setImages([]);
    setSlashOpen(false);
  }

  const sendDisabled = !busy && !value.trim() && images.length === 0;

  return (
    <div className="composer-wrap nodrag">
      {budgetLine && <div className="budget-line">{budgetLine}</div>}
      {topAccessory}
      <div className="composer-box">
        <SlashPalette
          ref={slashRef}
          value={slashOpen ? value : ""}
          setValue={onChange}
          ctx={ctx}
          modelOptions={modelOptions}
          onClose={() => setSlashOpen(false)}
        />
        {images.length > 0 && (
          <div className="composer-images">
            {images.map((image, index) => (
              <span className="composer-image" key={`${image.mimeType}-${index}`}>
                <img src={`data:${image.mimeType};base64,${image.data}`} alt="" />
                <button type="button" title="移除图片" onClick={() => setImages((items) => items.filter((_, i) => i !== index))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="ask"
          rows={1}
          placeholder={placeholder}
          value={value}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next);
            setSlashOpen(next.startsWith("/"));
          }}
          onFocus={() => setSlashOpen(value.startsWith("/"))}
          onBlur={() => window.setTimeout(() => setSlashOpen(false), 120)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            const nativeEvent = event.nativeEvent as KeyboardEvent & { keyCode?: number };
            const isComposing = composingRef.current || event.nativeEvent.isComposing || nativeEvent.keyCode === 229;
            if (isComposing) return;
            if (slashOpen && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
              slashRef.current?.handleKeyDown(event);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-hint">输入 / 打开命令</div>
        <div className="composer-bar">
          <input
            ref={fileRef}
            className="composer-file"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              void onFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <CommandMenu ctx={ctx} />
          <button
            type="button"
            className={`mount-toggle ${mount ? "on" : ""}`}
            onClick={() => onToggleMount(!mount)}
            title="是否把根→父的完整路径也一并发给模型（上下文更全，但更贵）"
          >
            挂载祖先
          </button>
          <button
            type="button"
            className={`round-send ${busy ? "is-stop" : ""}`}
            onClick={busy ? onStop : submit}
            disabled={sendDisabled}
            title={busy ? "停止生成" : "发送"}
          >
            {busy ? <Square size={12} fill="currentColor" strokeWidth={0} /> : <IconSend />}
          </button>
        </div>
      </div>
    </div>
  );
}
