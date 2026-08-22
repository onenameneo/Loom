import { create } from "zustand";
import type { ApprovalCenterEvent, ApprovalRequestPayload, CanvasNodeDto, LiveTurnContentPart, LiveTurnEvent, LiveTurnPatch, LiveTurnSnapshot, ProjectMeta, SessionMeta, TodoPlanEventPayload, TodoPlanSnapshot } from "../env";

export type LiveTurnApplyResult = "applied" | "ignored" | "recovery";

export type WorkspaceStore = {
  projectIds: string[];
  projectsById: Record<string, ProjectMeta>;
  sessionsById: Record<string, SessionMeta>;
  nodesById: Record<string, CanvasNodeDto>;
  sessionIdsByProjectId: Record<string, string[]>;
  nodeIdsBySessionId: Record<string, string[]>;
  activeProjectId: string | null;
  activeSessionId: string | null;
  activeNodeId: string | null;
  turnsByNodeId: Record<string, LiveTurnSnapshot>;
  latestLiveRevisionByNodeId: Record<string, number>;
  approvalsById: Record<string, ApprovalRequestPayload>;
  latestApprovalRevision: number;
  plansByNodeId: Record<string, TodoPlanSnapshot>;
  latestTodoRevisionByNodeId: Record<string, number>;
  hydrateProjects: (projects: ProjectMeta[]) => void;
  hydrateSessions: (projectId: string, sessions: SessionMeta[]) => void;
  hydrateNodes: (sessionId: string, nodes: CanvasNodeDto[]) => void;
  patchNode: (nodeId: string, patch: Partial<Pick<CanvasNodeDto, "title" | "color">>) => void;
  selectProject: (projectId: string | null) => void;
  selectSession: (sessionId: string | null) => void;
  selectNode: (nodeId: string | null) => void;
  applyLiveTurn: (event: LiveTurnEvent) => LiveTurnApplyResult;
  hydrateApprovals: (requests: ApprovalRequestPayload[]) => void;
  applyApproval: (event: ApprovalCenterEvent) => void;
  applyTodoPlan: (payload: TodoPlanEventPayload) => void;
  hydrateTodoPlan: (nodeId: string, snapshot?: TodoPlanSnapshot) => void;
};

type WorkspaceData = Omit<WorkspaceStore,
  "hydrateProjects" | "hydrateSessions" | "hydrateNodes" | "patchNode" | "selectProject" | "selectSession" | "selectNode" | "applyLiveTurn" | "hydrateApprovals" | "applyApproval" | "applyTodoPlan" | "hydrateTodoPlan"
>;

const emptyWorkspace = (): WorkspaceData => ({
  projectIds: [],
  projectsById: {},
  sessionsById: {},
  nodesById: {},
  sessionIdsByProjectId: {},
  nodeIdsBySessionId: {},
  activeProjectId: null,
  activeSessionId: null,
  activeNodeId: null,
  turnsByNodeId: {},
  latestLiveRevisionByNodeId: {},
  approvalsById: {},
  latestApprovalRevision: 0,
  plansByNodeId: {},
  latestTodoRevisionByNodeId: {},
});

function replaceEntities<T extends { id: string }>(
  current: Record<string, T>,
  previousIds: string[],
  nextEntities: T[],
): Record<string, T> {
  const next = { ...current };
  for (const id of previousIds) delete next[id];
  for (const entity of nextEntities) next[entity.id] = entity;
  return next;
}

function legacyContentParts(snapshot: LiveTurnSnapshot): LiveTurnContentPart[] {
  if (snapshot.contentParts?.length) return snapshot.contentParts;
  const parts: LiveTurnContentPart[] = [];
  if (snapshot.assistantThinking) parts.push({ partId: `${snapshot.turnId}:legacy:thinking`, kind: "thinking", text: snapshot.assistantThinking, sequence: 1 });
  if (snapshot.assistantText) parts.push({ partId: `${snapshot.turnId}:legacy:text`, kind: "text", text: snapshot.assistantText, sequence: parts.length + 1 });
  return parts;
}

function applyLivePatch(snapshot: LiveTurnSnapshot, event: LiveTurnPatch): LiveTurnSnapshot | undefined {
  const currentSequence = snapshot.contentSequence ?? 0;
  if (event.sequenceStart !== currentSequence + (event.parts.length > 0 ? 1 : 0)) return undefined;
  const contentParts = legacyContentParts(snapshot).map((part) => ({ ...part }));
  for (const patch of event.parts) {
    const index = contentParts.findIndex((part) => part.partId === patch.partId);
    if (index >= 0) {
      const current = contentParts[index];
      if (current.kind !== patch.kind) return undefined;
      contentParts[index] = { ...current, text: `${current.text}${patch.delta}` };
    } else {
      contentParts.push({ partId: patch.partId, kind: patch.kind, text: patch.delta, sequence: patch.sequence });
    }
  }
  return {
    ...snapshot,
    state: event.state,
    approval: event.approval,
    revision: event.revision,
    contentParts,
    contentSequence: event.sequenceEnd,
    assistantText: contentParts.filter((part) => part.kind === "text").map((part) => part.text).join(""),
    assistantThinking: contentParts.filter((part) => part.kind === "thinking").map((part) => part.text).join("") || undefined,
  };
}

export const useWorkspaceStore = create<WorkspaceStore>()((set) => ({
  ...emptyWorkspace(),
  hydrateProjects(projects) {
    set((state) => {
      const projectsById = Object.fromEntries(projects.map((project) => [project.id, project]));
      const activeProjectId = state.activeProjectId && projectsById[state.activeProjectId]
        ? state.activeProjectId
        : null;
      return {
        projectIds: projects.map((project) => project.id),
        projectsById,
        activeProjectId,
        activeSessionId: activeProjectId === state.activeProjectId ? state.activeSessionId : null,
        activeNodeId: activeProjectId === state.activeProjectId ? state.activeNodeId : null,
      };
    });
  },
  hydrateSessions(projectId, sessions) {
    set((state) => {
      const previousIds = state.sessionIdsByProjectId[projectId] ?? [];
      const isActiveProject = state.activeProjectId === projectId;
      const activeSessionId = isActiveProject && state.activeSessionId &&
        sessions.some((session) => session.id === state.activeSessionId)
        ? state.activeSessionId
        : isActiveProject ? null : state.activeSessionId;
      return {
        sessionsById: replaceEntities(state.sessionsById, previousIds, sessions),
        sessionIdsByProjectId: { ...state.sessionIdsByProjectId, [projectId]: sessions.map((session) => session.id) },
        activeSessionId,
        activeNodeId: activeSessionId === state.activeSessionId ? state.activeNodeId : null,
      };
    });
  },
  hydrateNodes(sessionId, nodes) {
    set((state) => {
      const previousIds = state.nodeIdsBySessionId[sessionId] ?? [];
      return {
        nodesById: replaceEntities(state.nodesById, previousIds, nodes),
        nodeIdsBySessionId: { ...state.nodeIdsBySessionId, [sessionId]: nodes.map((node) => node.id) },
      };
    });
  },
  patchNode(nodeId, patch) {
    set((state) => {
      const node = state.nodesById[nodeId];
      return node ? { nodesById: { ...state.nodesById, [nodeId]: { ...node, ...patch } } } : state;
    });
  },
  selectProject(projectId) {
    set({ activeProjectId: projectId, activeSessionId: null, activeNodeId: null });
  },
  selectSession(sessionId) {
    set({ activeSessionId: sessionId, activeNodeId: null });
  },
  selectNode(nodeId) {
    set({ activeNodeId: nodeId });
  },
  applyLiveTurn(event) {
    let result: LiveTurnApplyResult = "ignored";
    set((state) => {
      const nodeId = event.type === "upsert" ? event.snapshot.nodeId : event.nodeId;
      const revision = event.type === "upsert" ? event.snapshot.revision : event.revision;
      if (revision <= (state.latestLiveRevisionByNodeId[nodeId] ?? 0)) return state;
      if (event.type === "patch") {
        const current = state.turnsByNodeId[nodeId];
        if (!current || current.turnId !== event.turnId) {
          result = "recovery";
          return state;
        }
        const next = applyLivePatch(current, event);
        if (!next) {
          result = "recovery";
          return state;
        }
        result = "applied";
        return {
          turnsByNodeId: { ...state.turnsByNodeId, [nodeId]: next },
          latestLiveRevisionByNodeId: { ...state.latestLiveRevisionByNodeId, [nodeId]: revision },
        };
      }
      const turnsByNodeId = { ...state.turnsByNodeId };
      if (event.type === "upsert" || event.type === "replace") turnsByNodeId[nodeId] = event.snapshot;
      else delete turnsByNodeId[nodeId];
      result = "applied";
      return {
        turnsByNodeId,
        latestLiveRevisionByNodeId: { ...state.latestLiveRevisionByNodeId, [nodeId]: revision },
      };
    });
    return result;
  },
  hydrateApprovals(requests) {
    set((state) => {
      const approvalsById = { ...state.approvalsById };
      for (const request of requests) {
        if (request.revision > state.latestApprovalRevision) approvalsById[request.requestId] = request;
      }
      return {
        approvalsById,
        latestApprovalRevision: Math.max(state.latestApprovalRevision, ...requests.map((request) => request.revision)),
      };
    });
  },
  applyApproval(event) {
    set((state) => {
      const revision = event.type === "upsert" ? event.request.revision : event.revision;
      if (revision <= state.latestApprovalRevision) return state;
      const approvalsById = { ...state.approvalsById };
      if (event.type === "upsert") approvalsById[event.request.requestId] = event.request;
      else delete approvalsById[event.requestId];
      return { approvalsById, latestApprovalRevision: revision };
    });
  },
  applyTodoPlan(payload) {
    set((state) => {
      const revision = payload.revision ?? payload.snapshot.revision;
      if (revision <= (state.latestTodoRevisionByNodeId[payload.nodeId] ?? 0)) return state;
      const plansByNodeId = { ...state.plansByNodeId };
      if (payload.snapshot.status === "cleared") delete plansByNodeId[payload.nodeId];
      else plansByNodeId[payload.nodeId] = payload.snapshot;
      return { plansByNodeId, latestTodoRevisionByNodeId: { ...state.latestTodoRevisionByNodeId, [payload.nodeId]: revision } };
    });
  },
  hydrateTodoPlan(nodeId, snapshot) {
    set((state) => {
      const revision = snapshot?.revision ?? 0;
      if (revision < (state.latestTodoRevisionByNodeId[nodeId] ?? 0)) return state;
      const plansByNodeId = { ...state.plansByNodeId };
      if (snapshot && snapshot.status !== "cleared") plansByNodeId[nodeId] = snapshot;
      else delete plansByNodeId[nodeId];
      return { plansByNodeId, latestTodoRevisionByNodeId: { ...state.latestTodoRevisionByNodeId, [nodeId]: revision } };
    });
  },
}));

export function resetWorkspaceStore() {
  useWorkspaceStore.setState(emptyWorkspace());
}

export const selectProjects = (state: WorkspaceStore): ProjectMeta[] =>
  state.projectIds.flatMap((id) => state.projectsById[id] ? [state.projectsById[id]] : []);

export const selectSessionsForProject = (state: WorkspaceStore, projectId: string | null): SessionMeta[] =>
  projectId ? (state.sessionIdsByProjectId[projectId] ?? []).flatMap((id) => state.sessionsById[id] ? [state.sessionsById[id]] : []) : [];

export const selectNodesForSession = (state: WorkspaceStore, sessionId: string | null): CanvasNodeDto[] =>
  sessionId ? (state.nodeIdsBySessionId[sessionId] ?? []).flatMap((id) => state.nodesById[id] ? [state.nodesById[id]] : []) : [];

export const selectNodeLiveTurn = (state: WorkspaceStore, nodeId: string): LiveTurnSnapshot | undefined => state.turnsByNodeId[nodeId];
export const selectNodeApproval = (state: WorkspaceStore, nodeId: string): ApprovalRequestPayload | undefined => Object.values(state.approvalsById).find((approval) => approval.nodeId === nodeId);
export const selectNodeTodoPlan = (state: WorkspaceStore, nodeId: string): TodoPlanSnapshot | undefined => state.plansByNodeId[nodeId];
export const selectPendingApprovals = (state: WorkspaceStore): ApprovalRequestPayload[] => Object.values(state.approvalsById).sort((a, b) => a.createdAt - b.createdAt);
export const selectTodoProgress = (state: WorkspaceStore, nodeId: string) => {
  const plan = state.plansByNodeId[nodeId];
  if (!plan) return { total: 0, completed: 0, active: 0, blocked: 0 };
  return {
    total: plan.todos.length,
    completed: plan.todos.filter((todo) => todo.status === "completed").length,
    active: plan.todos.filter((todo) => todo.status === "in_progress").length,
    blocked: plan.todos.filter((todo) => todo.status === "blocked").length,
  };
};

export const selectRunningNodeCount = (state: WorkspaceStore, sessionId: string): number =>
  Object.values(state.turnsByNodeId).filter((turn) => turn.sessionId === sessionId).length;
