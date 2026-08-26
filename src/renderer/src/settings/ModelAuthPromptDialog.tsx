import { useEffect, useState } from "react";
import { Modal } from "../ui/dialogs";
import { buttonClassName, dialogDescriptionClassName, dialogTitleClassName } from "../ui/styles";
import type { ModelAuthPrompt } from "../env";

export function ModelAuthPromptDialog({ prompt, onRespond }: { prompt: ModelAuthPrompt | null; onRespond: (value?: string, cancelled?: boolean) => void }) {
  const [value, setValue] = useState("");
  useEffect(() => { setValue(""); }, [prompt?.requestId]);
  if (!prompt) return null;
  const submit = () => onRespond(value, false);
  return (
    <Modal open={Boolean(prompt)} onOpenChange={(open) => { if (!open) onRespond(undefined, true); }} ariaLabel="认证输入">
      <div className="settings-modal__panel model-auth-prompt">
        <div className="settings-modal__head"><h3 className={dialogTitleClassName}>完成订阅授权</h3></div>
        <p className={dialogDescriptionClassName}>{prompt.prompt.message}</p>
        {prompt.prompt.type === "select" ? <div className="model-auth-prompt__options">{prompt.prompt.options.map((option) => <button key={option.id} type="button" className={`model-auth-prompt__option ${value === option.id ? "selected" : ""}`} onClick={() => setValue(option.id)}><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</button>)}</div> : <input autoFocus type={prompt.prompt.type === "secret" ? "password" : "text"} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && value.trim()) submit(); }} placeholder={prompt.prompt.placeholder} />}
        <div className="settings-foot"><button className={buttonClassName()} type="button" onClick={() => onRespond(undefined, true)}>取消</button><button className={buttonClassName("primary")} type="button" onClick={submit} disabled={!value.trim()}>继续</button></div>
      </div>
    </Modal>
  );
}
