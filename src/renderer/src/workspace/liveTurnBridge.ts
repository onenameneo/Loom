import type { LiveTurnEvent, LiveTurnPatch, LiveTurnSnapshot } from "../env";
import { useWorkspaceStore } from "./store";

type LiveTurnApi = {
  liveTurns: () => Promise<LiveTurnSnapshot[]>;
  onLiveTurn: (listener: (event: LiveTurnEvent) => void) => () => void;
  liveTurn?: (nodeId: string) => Promise<LiveTurnSnapshot | undefined>;
};

type LiveTurnStore = Pick<typeof useWorkspaceStore, "getState">;

export type LiveTurnDiagnostic = {
  kind: "stale_or_duplicate" | "sequence_gap" | "recovery_requested" | "replace_applied";
  nodeId: string;
  turnId?: string;
  revision?: number;
};

export type LiveTurnBridgeOptions = {
  scheduleFrame?: (flush: () => void) => unknown;
  onDiagnostic?: (diagnostic: LiveTurnDiagnostic) => void;
};

export function connectLiveTurnBridge(
  api: LiveTurnApi,
  store: LiveTurnStore = useWorkspaceStore,
  options: LiveTurnBridgeOptions = {},
) {
  let active = true;
  const recovering = new Set<string>();
  const pendingPatches: LiveTurnEvent[] = [];
  let frameScheduled = false;
  const scheduleFrame = options.scheduleFrame ?? ((flush: () => void) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  });
  const apply = (event: LiveTurnEvent) => store.getState().applyLiveTurn(event);
  const applyWithRecovery = (event: LiveTurnEvent) => {
    const result = apply(event);
    const nodeId = event.type === "upsert" ? event.snapshot.nodeId : event.nodeId;
    const turnId = event.type === "upsert" || event.type === "replace" ? event.snapshot.turnId : event.type === "patch" ? event.turnId : undefined;
    const revision = event.type === "upsert" ? event.snapshot.revision : event.revision;
    if (result === "ignored") {
      options.onDiagnostic?.({ kind: "stale_or_duplicate", nodeId, turnId, revision });
      return;
    }
    if (event.type === "replace" && result === "applied") options.onDiagnostic?.({ kind: "replace_applied", nodeId, turnId, revision });
    if (result !== "recovery" || !api.liveTurn) return;
    options.onDiagnostic?.({ kind: "sequence_gap", nodeId, turnId, revision });
    if (recovering.has(nodeId)) return;
    recovering.add(nodeId);
    options.onDiagnostic?.({ kind: "recovery_requested", nodeId, turnId, revision });
    void api.liveTurn(nodeId).then((snapshot) => {
      recovering.delete(nodeId);
      if (!active || !snapshot) return;
      apply({ type: "replace", nodeId: snapshot.nodeId, turnId: snapshot.turnId, revision: snapshot.revision, snapshot });
    }).catch(() => {
      recovering.delete(nodeId);
    });
  };
  const flushPatches = () => {
    frameScheduled = false;
    const patches = pendingPatches.splice(0);
    if (!active) return;
    for (const event of patches) applyWithRecovery(event);
  };
  const queuePatch = (event: LiveTurnEvent) => {
    const previous = pendingPatches.at(-1);
    if (previous?.type === "patch" && event.type === "patch" &&
      previous.nodeId === event.nodeId && previous.turnId === event.turnId &&
      event.sequenceStart === previous.sequenceEnd + (event.parts.length > 0 ? 1 : 0)) {
      const merged: LiveTurnPatch = {
        ...event,
        sequenceStart: previous.sequenceStart,
        sequenceEnd: event.sequenceEnd,
        sequence: event.sequenceEnd,
        parts: [...previous.parts, ...event.parts],
      };
      pendingPatches[pendingPatches.length - 1] = merged;
    } else {
      pendingPatches.push(event);
    }
    if (frameScheduled) return;
    frameScheduled = true;
    scheduleFrame(flushPatches);
  };
  const unsubscribe = api.onLiveTurn((event) => {
    if (!active) return;
    if (event.type === "patch") {
      queuePatch(event);
      return;
    }
    if (event.type === "remove") {
      // A terminal event can arrive in the same task as the final queued
      // patch. Apply that patch now, but defer removal by one frame so React
      // can commit the complete assistant message before liveTurn disappears.
      flushPatches();
      scheduleFrame(() => {
        if (active) applyWithRecovery(event);
      });
      return;
    }
    flushPatches();
    applyWithRecovery(event);
  });
  void api.liveTurns().then((snapshots) => {
    if (!active) return;
    for (const snapshot of snapshots) applyWithRecovery({ type: "upsert", snapshot });
  });
  return () => {
    active = false;
    unsubscribe();
  };
}
