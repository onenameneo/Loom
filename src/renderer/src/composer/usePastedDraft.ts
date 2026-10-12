import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { editVisibleDraft, fullDraft, insertTextFragment, restorePastedDraft, type PastedDraft } from "./pastedDraft";

const storageKey = (nodeId: string) => `loom:pasted-draft:${nodeId}`;

function readDraft(nodeId: string, value: string): PastedDraft {
  try { return restorePastedDraft(value, JSON.parse(localStorage.getItem(storageKey(nodeId)) ?? "null")); }
  catch { return { text: value, fragments: [] }; }
}

export function usePastedDraft(nodeId: string, value: string, onChange: (value: string) => void) {
  const [snapshot, setSnapshot] = useState(() => ({ nodeId, value, draft: readDraft(nodeId, value) }));
  const current = useRef({ nodeId, value });
  current.current = { nodeId, value };
  const history = useRef<{ active: boolean; past: PastedDraft[]; future: PastedDraft[] }>({ active: false, past: [], future: [] });
  const draft = snapshot.nodeId === nodeId && snapshot.value === value ? snapshot.draft : readDraft(nodeId, value);

  useEffect(() => {
    if (snapshot.nodeId !== nodeId || snapshot.value !== value) {
      setSnapshot({ nodeId, value, draft });
      history.current = { active: draft.fragments.length > 0, past: [], future: [] };
    }
    if (snapshot.nodeId === nodeId && !value) {
      try { localStorage.removeItem(storageKey(nodeId)); } catch { /* Optional presentation metadata. */ }
    }
  }, [draft, nodeId, snapshot.nodeId, snapshot.value, value]);

  function commit(next: PastedDraft, record = true) {
    if (record && (history.current.active || draft.fragments.length || next.fragments.length)) {
      history.current.active = true;
      history.current.past.push(draft);
      if (history.current.past.length > 100) history.current.past.shift();
      history.current.future = [];
    }
    const nextValue = fullDraft(next);
    try {
      if (next.fragments.length) localStorage.setItem(storageKey(nodeId), JSON.stringify({ version: 1, ...next }));
      else localStorage.removeItem(storageKey(nodeId));
    } catch { /* Canonical plain-text persistence remains the fallback. */ }
    setSnapshot({ nodeId, value: nextValue, draft: next });
    onChange(nextValue);
  }

  function handleHistory(event: KeyboardEvent) {
    if (!history.current.active || !(event.metaKey || event.ctrlKey) || event.altKey) return false;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return false;
    event.preventDefault();
    const redo = key === "y" || event.shiftKey;
    const source = redo ? history.current.future : history.current.past;
    const next = source.pop();
    if (next) {
      (redo ? history.current.past : history.current.future).push(draft);
      commit(next, false);
    }
    return true;
  }

  return {
    draft,
    changeText: (text: string) => commit(editVisibleDraft(draft, text)),
    paste: (start: number, end: number, text: string) => commit(insertTextFragment(draft, start, end, text, crypto.randomUUID())),
    changeFragment: (id: string, text: string) => commit({ ...draft, fragments: draft.fragments.map((f) => f.id === id ? { ...f, text } : f) }),
    removeFragment: (id: string) => commit({ ...draft, fragments: draft.fragments.filter((f) => f.id !== id) }),
    handleHistory,
    restoreAfterFailure: (submitted: PastedDraft) => {
      if (current.current.nodeId === nodeId && (!current.current.value || current.current.value === fullDraft(submitted).trim())) commit(submitted, false);
    },
  };
}
