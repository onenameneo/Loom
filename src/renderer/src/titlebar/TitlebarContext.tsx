import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type TitlebarContextDescriptor = {
  icon?: ReactNode;
  title: string;
  mode?: "对话" | "画布";
  subtitle?: string;
};

export type TitlebarActions = ReactNode;

export type TitlebarDescriptor = TitlebarContextDescriptor & {
  actions?: TitlebarActions;
};

type Entry<T> = {
  token: number;
  value: T;
};

type TitlebarRegistry = {
  registerContext: (descriptor: TitlebarContextDescriptor) => () => void;
  registerActions: (actions: TitlebarActions) => () => void;
};

type ResolvedTitlebar = {
  context: TitlebarContextDescriptor;
  actions: TitlebarActions;
};

const TitlebarRegistryContext = createContext<TitlebarRegistry | null>(null);
const ResolvedTitlebarContext = createContext<ResolvedTitlebar | null>(null);

function removeEntry<T>(entries: Entry<T>[], token: number): Entry<T>[] {
  const index = entries.findIndex((entry) => entry.token === token);
  if (index === -1) return entries;
  return [...entries.slice(0, index), ...entries.slice(index + 1)];
}

export function TitlebarProvider({
  defaultDescriptor,
  children,
}: {
  defaultDescriptor: TitlebarContextDescriptor;
  children: ReactNode;
}) {
  const nextTokenRef = useRef(0);
  const [contextEntries, setContextEntries] = useState<Entry<TitlebarContextDescriptor>[]>([]);
  const [actionEntries, setActionEntries] = useState<Entry<TitlebarActions>[]>([]);

  const registerContext = useCallback((descriptor: TitlebarContextDescriptor) => {
    const token = ++nextTokenRef.current;
    setContextEntries((entries) => [...entries, { token, value: descriptor }]);
    return () => setContextEntries((entries) => removeEntry(entries, token));
  }, []);

  const registerActions = useCallback((actions: TitlebarActions) => {
    const token = ++nextTokenRef.current;
    setActionEntries((entries) => [...entries, { token, value: actions }]);
    return () => setActionEntries((entries) => removeEntry(entries, token));
  }, []);

  const registry = useMemo(
    () => ({ registerContext, registerActions }),
    [registerActions, registerContext],
  );
  const resolved = useMemo(
    () => ({
      context: contextEntries.at(-1)?.value ?? defaultDescriptor,
      actions: actionEntries.at(-1)?.value,
    }),
    [actionEntries, contextEntries, defaultDescriptor],
  );

  return (
    <TitlebarRegistryContext.Provider value={registry}>
      <ResolvedTitlebarContext.Provider value={resolved}>{children}</ResolvedTitlebarContext.Provider>
    </TitlebarRegistryContext.Provider>
  );
}

function useTitlebarRegistry(): TitlebarRegistry {
  const registry = useContext(TitlebarRegistryContext);
  if (!registry) throw new Error("Titlebar hooks must be used within TitlebarProvider");
  return registry;
}

export function useTitlebarContext(descriptor: TitlebarContextDescriptor): void {
  const { registerContext } = useTitlebarRegistry();
  useLayoutEffect(() => registerContext(descriptor), [descriptor, registerContext]);
}

export function useTitlebarActions(actions: TitlebarActions): void {
  const { registerActions } = useTitlebarRegistry();
  useLayoutEffect(() => registerActions(actions), [actions, registerActions]);
}

export function useResolvedTitlebar(): ResolvedTitlebar {
  const resolved = useContext(ResolvedTitlebarContext);
  if (!resolved) throw new Error("useResolvedTitlebar must be used within TitlebarProvider");
  return resolved;
}

export function useTitlebar(descriptor: TitlebarDescriptor): void {
  useTitlebarContext({
    icon: descriptor.icon,
    title: descriptor.title,
    mode: descriptor.mode,
    subtitle: descriptor.subtitle,
  });
  useTitlebarActions(descriptor.actions);
}
