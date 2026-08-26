import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { iconButtonClassName } from "./styles";

export type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = ++nextId.current;
    setItems((current) => [...current.slice(-3), { id, message, tone }]);
    const timer = window.setTimeout(() => dismiss(id), tone === "error" ? 6000 : 4200);
    timers.current.set(id, timer);
  }, [dismiss]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-viewport" aria-label={t("common.notifications")} aria-live="polite">
        {items.map((item) => {
          const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? AlertCircle : Info;
          return (
            <div key={item.id} className={`toast toast--${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
              <Icon className="toast__icon" size={16} aria-hidden="true" />
              <span className="toast__message">{item.message}</span>
              <button className={iconButtonClassName("default", "toast__close")} type="button" onClick={() => dismiss(item.id)} aria-label={t("common.dismiss")} title={t("common.dismiss")}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
