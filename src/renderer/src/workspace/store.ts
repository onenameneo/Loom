import { create } from "zustand";
import type { CanvasNodeDto, LiveTurnEvent, LiveTurnSnapshot, ProjectMeta, SessionMeta } from "../env";

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
  hydrateProjects: (projects: ProjectMeta[]) => void;
  hydrateSessions: (projectId: string, sessions: SessionMeta[]) => void;
  hydrateNodes: (sessionId: string, nodes: CanvasNodeDto[]) => void;
  patchNode: (nodeId: string, patch: Partial<Pick<CanvasNodeDto, "title" | "color">>) => void;
  selectProject: (projectId: string | null) => void;
  selectSession: (sessionId: string | null) => void;
  selectNode: (nodeId: string | null) => void;
  applyLiveTurn: (event: LiveTurnEvent) => void;
};

type WorkspaceData = Omit<WorkspaceStore,
  "hydrateProjects" | "hydrateSessions" | "hydrateNodes" | "patchNode" | "selectProject" | "selectSession" | "selectNode" | "applyLiveTurn"
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
    set((state) => {
      const nodeId = event.type === "upsert" ? event.snapshot.nodeId : event.nodeId;
      const revision = event.type === "upsert" ? event.snapshot.revision : event.revision;
      if (revision <= (state.latestLiveRevisionByNodeId[nodeId] ?? 0)) return state;
      const turnsByNodeId = { ...state.turnsByNodeId };
      if (event.type === "upsert") turnsByNodeId[nodeId] = event.snapshot;
      else delete turnsByNodeId[nodeId];
      return {
        turnsByNodeId,
        latestLiveRevisionByNodeId: { ...state.latestLiveRevisionByNodeId, [nodeId]: revision },
      };
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

export const selectRunningNodeCount = (state: WorkspaceStore, sessionId: string): number =>
  Object.values(state.turnsByNodeId).filter((turn) => turn.sessionId === sessionId).length;
