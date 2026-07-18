export type ShellPhase = "expanded" | "collapsing" | "collapsed" | "expanding";

export interface ShellState {
  phase: ShellPhase;
  version: number;
}

interface ShellTransitionCompletion {
  targetIsShell: boolean;
  propertyName: string;
  version: number;
}

export function createShellState(collapsed: boolean): ShellState {
  return { phase: collapsed ? "collapsed" : "expanded", version: 0 };
}

export function requestShellToggle(state: ShellState, reducedMotion: boolean): ShellState {
  if (state.phase === "collapsing" || state.phase === "expanding") return state;

  const version = state.version + 1;
  const collapsing = state.phase === "expanded";

  if (reducedMotion) {
    return { phase: collapsing ? "collapsed" : "expanded", version };
  }

  return { phase: collapsing ? "collapsing" : "expanding", version };
}

export function completeShellTransition(
  state: ShellState,
  completion: ShellTransitionCompletion,
): ShellState {
  if (
    (state.phase !== "collapsing" && state.phase !== "expanding") ||
    !completion.targetIsShell ||
    completion.propertyName !== "--sidebar-width" ||
    completion.version !== state.version
  ) {
    return state;
  }

  return {
    phase: state.phase === "collapsing" ? "collapsed" : "expanded",
    version: state.version,
  };
}
