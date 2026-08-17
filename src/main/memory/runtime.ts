import type { BrowserWindow } from "electron";
import { sendToWindow } from "../ipcSafeSend";
import { AutoDreamService, type AutoDreamProgress, type AutoDreamRunSummary } from "./autodream";
import { MemoryExtractionService, parseMemoryCommand, type RestrictedExtractor, type TurnMemoryInput } from "./extraction";
import { MemoryFileAccess } from "./fileAccess";
import { MemoryRetriever, type RetrievalQuery, type RetrievalResult } from "./retrieval";
import { defaultMemoryRoot, MemoryStore } from "./storage";
import { buildMemoryPrompt } from "./prompt";
import type { MemoryRecord, MemoryStats, MemoryWriteInput } from "./types";
import type { MemorySettings } from "../store/store";

export type MemoryRuntimeEvent =
  | { type: "changed"; action: string; record?: MemoryRecord }
  | { type: "extraction"; sessionId: string; candidates: MemoryRecord[]; skipped: boolean; error?: string }
  | { type: "autodream"; progress: AutoDreamProgress | { phase: "completed" | "failed" | "cancelled"; summary?: AutoDreamRunSummary } };

export interface MemoryCommandContext {
  sessionId: string;
  nodeId: string;
  projectId?: string;
}

export interface MemoryRuntimePort {
  retrieve(sessionId: string, query: RetrievalQuery): Promise<RetrievalResult>;
  memoryPrompt?(projectId?: string): string | undefined;
  fileAccess?(projectId?: string, context?: { sessionId: string; nodeId: string }): MemoryFileAccess;
  handleCommand(text: string, context: MemoryCommandContext): Promise<{ handled: boolean; ok: boolean; record?: MemoryRecord; message?: string }>;
  afterTurn(input: TurnMemoryInput): Promise<void>;
}

export interface MemoryRuntimeService extends MemoryRuntimePort {
  store: MemoryStore;
  initialize(): Promise<void>;
  onEvent(listener: (event: MemoryRuntimeEvent) => void): () => void;
  list(projectId?: string, includeArchived?: boolean): Promise<Awaited<ReturnType<MemoryStore["listRecords"]>>>;
  stats(): Promise<MemoryStats>;
  preview(id: string): Promise<Awaited<ReturnType<MemoryStore["preview"]>>>;
  remember(input: MemoryWriteInput): Promise<MemoryRecord>;
  edit(id: string, patch: Partial<MemoryWriteInput>): Promise<MemoryRecord | undefined>;
  archive(id: string, reason?: string): Promise<MemoryRecord | undefined>;
  forget(id: string, reason?: string): Promise<MemoryRecord | undefined>;
  approveCandidate(id: string, overrides?: Parameters<MemoryStore["approveCandidate"]>[1]): Promise<MemoryRecord | undefined>;
  rejectCandidate(id: string, reason?: string): Promise<MemoryRecord | undefined>;
  recordSession(): Promise<void>;
  autoDreamStatus(): Promise<object>;
  maybeRunAutoDream(): Promise<AutoDreamRunSummary | undefined>;
  cancelAutoDream(): void;
}

export function createMemoryRuntime(options: {
  getWin?: () => BrowserWindow | null;
  homeDir: string;
  settings: () => MemorySettings;
  extractor?: RestrictedExtractor;
}): MemoryRuntimeService {
  let store = new MemoryStore({ rootDir: defaultMemoryRoot(options.homeDir, options.settings().rootDir) });
  let retriever = new MemoryRetriever(store);
  let extractor = new MemoryExtractionService(store, options.extractor);
  let autodream = new AutoDreamService(store);
  let configuredRoot = store.rootDir;
  async function ensureCurrentStore(): Promise<void> {
    const nextRoot = defaultMemoryRoot(options.homeDir, options.settings().rootDir);
    if (nextRoot === configuredRoot) return;
    store = new MemoryStore({ rootDir: nextRoot });
    retriever = new MemoryRetriever(store);
    extractor = new MemoryExtractionService(store, options.extractor);
    autodream = new AutoDreamService(store);
    configuredRoot = nextRoot;
  }
  const listeners = new Set<(event: MemoryRuntimeEvent) => void>();
  const primaryWrites = new Set<string>();
  const notePrimaryWrite = (record: MemoryRecord) => {
    if (record.source.sessionId && record.source.nodeId) primaryWrites.add(`${record.source.sessionId}:${record.source.nodeId}`);
  };
  const emit = (event: MemoryRuntimeEvent) => {
    for (const listener of listeners) listener(event);
    sendToWindow(options.getWin ?? (() => null), "memory:event", event);
  };

  const runtime = {
    get store() { return store; },
    async initialize() {
      await ensureCurrentStore();
      if (options.settings().enabled) await store.initialize();
    },
    onEvent(listener: (event: MemoryRuntimeEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async list(projectId?: string, includeArchived = false) {
      await ensureCurrentStore();
      return store.listRecords({ projectId, includeArchived });
    },
    memoryPrompt(projectId?: string) {
      if (!options.settings().enabled) return undefined;
      return buildMemoryPrompt(new MemoryFileAccess(store, projectId).descriptors());
    },
    fileAccess(projectId?: string, context?: { sessionId: string; nodeId: string }) {
      return new MemoryFileAccess(store, projectId, (record) => {
        notePrimaryWrite(record);
        if (context) primaryWrites.add(`${context.sessionId}:${context.nodeId}`);
      }, context);
    },
    async stats(): Promise<MemoryStats> {
      await ensureCurrentStore();
      return store.stats();
    },
    async preview(id: string) {
      await ensureCurrentStore();
      return store.preview(id);
    },
    async remember(input: MemoryWriteInput) {
      await ensureCurrentStore();
      const record = await store.remember(input);
      notePrimaryWrite(record);
      emit({ type: "changed", action: "remember", record });
      return record;
    },
    async edit(id: string, patch: Partial<MemoryWriteInput>) {
      await ensureCurrentStore();
      const record = await store.edit(id, patch);
      if (record) {
        notePrimaryWrite(record);
        emit({ type: "changed", action: "edit", record });
      }
      return record;
    },
    async archive(id: string, reason?: string) {
      await ensureCurrentStore();
      const record = await store.archive(id, reason);
      if (record) emit({ type: "changed", action: "archive", record });
      return record;
    },
    async forget(id: string, reason?: string) {
      await ensureCurrentStore();
      const record = await store.forget(id, reason);
      if (record) emit({ type: "changed", action: "forget", record });
      return record;
    },
    async approveCandidate(id: string, overrides?: Parameters<MemoryStore["approveCandidate"]>[1]) {
      await ensureCurrentStore();
      const record = await store.approveCandidate(id, overrides);
      if (record) emit({ type: "changed", action: "approve", record });
      return record;
    },
    async rejectCandidate(id: string, reason?: string) {
      await ensureCurrentStore();
      const record = await store.rejectCandidate(id, reason);
      if (record) emit({ type: "changed", action: "reject", record });
      return record;
    },
    async retrieve(sessionId: string, query: RetrievalQuery) {
      await ensureCurrentStore();
      const result = await retriever.retrieve(sessionId, query);
      if (result.issues.length) emit({ type: "changed", action: "retrieval-diagnostic" });
      return result;
    },
    async handleCommand(text: string, context: MemoryCommandContext) {
      await ensureCurrentStore();
      const command = parseMemoryCommand(text);
      if (!command) return { handled: false, ok: false };
      try {
        if (command.kind === "forget") {
          const record = await store.forget(command.id, "forgotten by user");
          if (!record) return { handled: true, ok: false, message: "没有找到这条记忆。" };
          emit({ type: "changed", action: "forget", record });
          return { handled: true, ok: true, record, message: `已归档记忆 ${record.id}。` };
        }
        if (command.type === "project" && !context.projectId) return { handled: true, ok: false, message: "项目记忆需要当前项目上下文。" };
        const scope = command.type === "project" || command.type === "reference" && context.projectId
          ? { kind: "project" as const, projectId: context.projectId! }
          : { kind: "user" as const };
        const record = await store.remember({
          type: command.type,
          scope,
          description: command.content.length > 64 ? `${command.content.slice(0, 61)}...` : command.content,
          content: command.content,
          source: { trigger: "explicit", sessionId: context.sessionId, nodeId: context.nodeId },
        });
        emit({ type: "changed", action: "remember", record });
        return { handled: true, ok: true, record, message: `已记住：${record.description}` };
      } catch (error) {
        return { handled: true, ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
    async afterTurn(input: TurnMemoryInput) {
      await ensureCurrentStore();
      const primaryMemoryWritten = primaryWrites.delete(`${input.sessionId}:${input.nodeId}`);
      if (!options.settings().enabled || !options.settings().backgroundExtraction) return;
      const result = await extractor.afterTurn({ ...input, primaryMemoryWritten });
      emit({ type: "extraction", sessionId: input.sessionId, candidates: result.candidates, skipped: result.skipped, error: result.error });
    },
    async recordSession() {
      await ensureCurrentStore();
      if (!options.settings().enabled) return;
      await store.incrementNewSessions();
      void runtime.maybeRunAutoDream();
    },
    async autoDreamStatus() {
      await ensureCurrentStore();
      return store.readOperationalState({ version: 1, newSessions: 0 });
    },
    async maybeRunAutoDream() {
      await ensureCurrentStore();
      if (!options.settings().enabled || !options.settings().autoDream) return undefined;
      const summary = await autodream.run(true, (progress) => emit({ type: "autodream", progress }));
      if (summary) emit({ type: "autodream", progress: { phase: summary.status === "completed" ? "completed" : summary.status, summary } });
      return summary;
    },
    cancelAutoDream() {
      autodream.cancel();
    },
  };
  return runtime as MemoryRuntimeService;
}
