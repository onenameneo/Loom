import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function serialize(value: unknown) {
  return JSON.stringify(value);
}

export function useSettingsDraft<T>({
  initial,
  onSave,
}: {
  initial: T;
  onSave: (value: T) => Promise<void>;
}) {
  const initialKey = useMemo(() => serialize(initial), [initial]);
  const [draft, setDraft] = useState<T>(initial);
  const [savedKey, setSavedKey] = useState(initialKey);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(initial);
    setSavedKey(initialKey);
    setSaved(false);
    setError(null);
  }, [initialKey]);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const dirty = serialize(draft) !== savedKey;
  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty || saving) return false;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await onSave(draft);
      setSavedKey(serialize(draft));
      setSaved(true);
      savedTimer.current = setTimeout(() => setSaved(false), 1800);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, onSave, saving]);

  const discard = useCallback(() => {
    setDraft(initial);
    setError(null);
    setSaved(false);
  }, [initial]);

  return { draft, setDraft, dirty, saving, saved, error, save, discard };
}
