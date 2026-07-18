import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { readSidebarCollapsed, SIDEBAR_STORAGE_KEY } from "./sidebarState";
import {
  completeShellTransition,
  createShellState,
  requestShellToggle,
  type ShellState,
} from "./shellState";

export type ShellCommandSource = "button" | "menu" | "browser";

type ShellTransitionEvent = {
  currentTarget: EventTarget;
  target: EventTarget;
  propertyName: string;
};

type AppShellControllerOptions = {
  toggleRef: RefObject<HTMLButtonElement>;
  sidebarContentRef: RefObject<HTMLElement>;
  reducedMotion?: boolean;
  storage?: Pick<Storage, "getItem" | "setItem">;
};

function getDefaultStorage(): Pick<Storage, "getItem" | "setItem"> {
  return window.localStorage;
}

function getInitialReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function useAppShellController({
  toggleRef,
  sidebarContentRef,
  reducedMotion: reducedMotionOverride,
  storage = getDefaultStorage(),
}: AppShellControllerOptions) {
  const [shell, setShell] = useState<ShellState>(() =>
    createShellState(readSidebarCollapsed(storage)),
  );
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [detectedReducedMotion, setDetectedReducedMotion] = useState(getInitialReducedMotion);
  const reducedMotion = reducedMotionOverride ?? detectedReducedMotion;

  useEffect(() => {
    if (reducedMotionOverride !== undefined || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setDetectedReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [reducedMotionOverride]);

  const requestToggle = useCallback(
    (source: ShellCommandSource): boolean => {
      const current = shellRef.current;
      const next = requestShellToggle(current, reducedMotion);
      if (next === current) return false;

      if (
        source === "menu" &&
        current.phase === "expanded" &&
        sidebarContentRef.current?.contains(document.activeElement)
      ) {
        toggleRef.current?.focus();
      }

      const targetCollapsed = next.phase === "collapsed" || next.phase === "collapsing";
      try {
        storage.setItem(SIDEBAR_STORAGE_KEY, targetCollapsed ? "1" : "0");
      } catch {
        // Persistence can be unavailable; the in-memory shell remains authoritative.
      }
      shellRef.current = next;
      setShell(next);
      return true;
    },
    [reducedMotion, sidebarContentRef, storage, toggleRef],
  );

  const completeTransition = useCallback(
    (event: ShellTransitionEvent, capturedVersion: number): boolean => {
      const current = shellRef.current;
      const next = completeShellTransition(current, {
        targetIsShell: event.target === event.currentTarget,
        propertyName: event.propertyName,
        version: capturedVersion,
      });
      if (next === current) return false;
      shellRef.current = next;
      setShell(next);
      return true;
    },
    [],
  );

  return { shell, requestToggle, completeTransition };
}
