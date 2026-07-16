export {};

export interface NodeMsg {
  role: "user" | "assistant";
  text: string;
  images?: { data: string; mimeType: string }[];
  seq: number;
  usage?: { totalTokens?: number };
  meta?: unknown;
}
export interface NodeSeed {
  text: string;
  from: string;
  parent: string;
}
export interface CanvasNodeDto {
  id: string;
  workspaceId: string;
  parentId?: string;
  title: string;
  seed?: NodeSeed;
  mountAncestors: boolean;
  systemPrompt?: string;
  model?: string;
  color?: string;
  messages: NodeMsg[];
}
export interface NodeBudget {
  withoutAncestors: number;
  withAncestors: number;
  estimated: boolean;
}
export interface CanvasEvent {
  nodeId: string;
  type: string;
  payload?: unknown;
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  order: number;
}

export interface SettingsPayload {
  access: { provider: string; baseUrl: string; model: string };
  appearance: { theme: "light" | "dark" | "system"; density: "comfortable" | "compact" };
  sources: { baseUrl: string; model: string; key: string };
  hasKey: boolean;
  encryptionAvailable: boolean;
  resolvedModel: string;
  resolvedTheme: "light" | "dark";
}

declare global {
  interface Window {
    api: {
      canvas: {
        list: (workspaceId: string) => Promise<CanvasNodeDto[]>;
        open: (workspaceId: string) => Promise<CanvasNodeDto[]>;
        create: (arg: { workspaceId: string; parentId?: string; seed?: NodeSeed; title?: string }) => Promise<CanvasNodeDto>;
        send: (nodeId: string, text: string, images?: { data: string; mimeType: string }[]) => Promise<{ ok: boolean }>;
        abort: (nodeId: string) => Promise<{ ok: boolean }>;
        regenerate: (nodeId: string) => Promise<{ ok: boolean }>;
        editResend: (arg: { nodeId: string; seq: number; text: string }) => Promise<{ ok: boolean }>;
        delete: (nodeId: string) => Promise<{ ok: boolean; deletedIds: string[] }>;
        setSystemPrompt: (nodeId: string, text: string) => Promise<{ ok: boolean }>;
        update: (nodeId: string, patch: { title?: string; color?: string }) => Promise<{ ok: boolean; node?: CanvasNodeDto }>;
        setMount: (nodeId: string, on: boolean) => Promise<{ ok: boolean; budget: NodeBudget }>;
        setModel: (nodeId: string, model: string) => Promise<{ ok: boolean }>;
        models: () => Promise<{ id: string; name: string }[]>;
        budget: (nodeId: string) => Promise<NodeBudget>;
        reset: (nodeId: string) => Promise<{ ok: boolean }>;
        onEvent: (cb: (e: CanvasEvent) => void) => () => void;
      };
      settings: {
        get: () => Promise<SettingsPayload>;
        set: (patch: any) => Promise<{ ok: boolean; appearance: any }>;
        setKey: (plain: string) => Promise<{ ok: boolean; encrypted: boolean }>;
      };
      workspaces: {
        list: () => Promise<WorkspaceMeta[]>;
        create: (name?: string) => Promise<WorkspaceMeta>;
        rename: (id: string, name: string) => Promise<{ ok: boolean }>;
        delete: (id: string) => Promise<{ ok: boolean }>;
        pin: (id: string, pinned: boolean) => Promise<{ ok: boolean }>;
      };
      onMenu: (cb: (action: string) => void) => () => void;
    };
  }
}
