import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, List } from "lucide-react";
import { Popover } from "radix-ui";
import { useI18n } from "../i18n/I18nProvider";

export type QuestionAnchor = { text: string; images?: unknown[]; fileMentions?: unknown[] };

export function QuestionNavigation({ questions, scrollRef, threadRef, resetKey, onNavigate }: {
  questions: QuestionAnchor[];
  scrollRef: RefObject<HTMLDivElement>;
  threadRef: RefObject<HTMLDivElement>;
  resetKey: string;
  onNavigate: () => void;
}) {
  const { t } = useI18n();
  const [position, setPosition] = useState({ index: 0, showPreview: false });
  const [open, setOpen] = useState(false);
  const frame = useRef<number>();
  const jumpFrame = useRef<number>();
  const selectedIndex = useRef<number | null>(null);
  const highlight = useRef<{ element: HTMLElement; timer: ReturnType<typeof setTimeout> }>();
  const currentIndex = Math.min(position.index, Math.max(0, questions.length - 1));

  useEffect(() => {
    const scroll = scrollRef.current;
    const thread = threadRef.current;
    if (!scroll || !thread) return;
    selectedIndex.current = null;
    setOpen(false);
    const measure = () => {
      const anchors = [...thread.querySelectorAll<HTMLElement>("[data-question-number]")];
      const box = scroll.getBoundingClientRect();
      const top = box.top;
      const scale = scroll.clientHeight > 0 && box.height > 0 ? box.height / scroll.clientHeight : 1;
      let index = 0;
      for (let i = 0; i < anchors.length; i++) {
        if (anchors[i].getBoundingClientRect().top <= top + 24 * scale) index = i;
        else break;
      }
      const selected = selectedIndex.current;
      const selectedRect = selected === null ? undefined : anchors[selected]?.getBoundingClientRect();
      // A short final answer may leave too little scroll range to align its question at the top.
      if (selected !== null && selectedRect && scroll.clientHeight > 0
        && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 24
        && selectedRect.bottom > top && selectedRect.top < top + scroll.clientHeight * scale) index = selected;
      const activeRect = anchors[index]?.getBoundingClientRect();
      const showPreview = Boolean(activeRect && activeRect.height > 0 && activeRect.bottom < top + 4 * scale);
      setPosition((old) => old.index === index && old.showPreview === showPreview ? old : { index, showPreview });
    };
    const schedule = () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };
    scroll.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    observer.observe(thread);
    schedule();
    return () => {
      scroll.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      if (jumpFrame.current !== undefined) cancelAnimationFrame(jumpFrame.current);
      if (highlight.current) {
        clearTimeout(highlight.current.timer);
        delete highlight.current.element.dataset.questionHighlighted;
      }
    };
  }, [questions.length, resetKey, scrollRef, threadRef]);

  function jump(index: number) {
    const scroll = scrollRef.current;
    const target = threadRef.current?.querySelector<HTMLElement>(`[data-question-number="${index + 1}"]`);
    if (!scroll || !target) return;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    if (jumpFrame.current !== undefined) cancelAnimationFrame(jumpFrame.current);
    onNavigate();
    selectedIndex.current = index;
    setOpen(false);
    setPosition({ index, showPreview: false });
    if (highlight.current) {
      clearTimeout(highlight.current.timer);
      delete highlight.current.element.dataset.questionHighlighted;
    }
    target.dataset.questionHighlighted = "true";
    highlight.current = { element: target, timer: setTimeout(() => { delete target.dataset.questionHighlighted; }, 1_200) };
    jumpFrame.current = requestAnimationFrame(() => {
      const box = scroll.getBoundingClientRect();
      // Canvas zoom transforms viewport rectangles, while scrollTop remains in node-local pixels.
      const scale = scroll.clientHeight > 0 && box.height > 0 ? box.height / scroll.clientHeight : 1;
      const top = Math.max(0, scroll.scrollTop + (target.getBoundingClientRect().top - box.top) / scale - 12);
      const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      if (typeof scroll.scrollTo === "function") scroll.scrollTo({ top, behavior });
      else scroll.scrollTop = top;
    });
  }

  function preview(question: QuestionAnchor): string {
    return question.text.trim().replace(/\s+/g, " ").slice(0, 80)
      || t(question.images?.length ? "chat.imageQuestion" : question.fileMentions?.length ? "chat.fileQuestion" : "chat.questionWithoutText");
  }

  if (!questions.length) return null;
  return (
    <nav className="question-navigation nodrag nowheel nopan" aria-label={t("chat.questionNavigation")}>
      <div className="question-navigation__controls">
        <button type="button" disabled={currentIndex === 0} aria-label={t("chat.previousQuestion")} title={t("chat.previousQuestion")} onClick={() => jump(currentIndex - 1)}><ChevronUp size={15} aria-hidden="true" /></button>
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild><button type="button" className="question-navigation__directory" aria-label={t("chat.questionDirectory")}><List size={14} aria-hidden="true" /><span>{t("chat.questionPosition", { current: currentIndex + 1, total: questions.length })}</span><ChevronDown size={12} aria-hidden="true" /></button></Popover.Trigger>
          <Popover.Portal><Popover.Content className="question-directory nodrag nowheel nopan" align="start" sideOffset={8} aria-label={t("chat.questionDirectory")}>
            <div className="question-directory__title">{t("chat.questionDirectory")}</div>
            <ol>{questions.map((question, index) => <li key={index}><button type="button" aria-current={index === currentIndex ? "location" : undefined} onClick={() => jump(index)}><span>{String(index + 1).padStart(2, "0")}</span><span>{preview(question)}</span></button></li>)}</ol>
          </Popover.Content></Popover.Portal>
        </Popover.Root>
        <button type="button" disabled={currentIndex === questions.length - 1} aria-label={t("chat.nextQuestion")} title={t("chat.nextQuestion")} onClick={() => jump(currentIndex + 1)}><ChevronDown size={15} aria-hidden="true" /></button>
      </div>
      <button type="button" className="question-navigation__preview" data-visible={position.showPreview} tabIndex={position.showPreview ? 0 : -1} aria-hidden={!position.showPreview} onClick={() => jump(currentIndex)} title={preview(questions[currentIndex])}>
        <span>{t("chat.currentQuestion", { text: preview(questions[currentIndex]) })}</span>
      </button>
    </nav>
  );
}
