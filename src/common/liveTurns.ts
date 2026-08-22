export type LiveTurnOperation = "send" | "regenerate" | "edit-resend";
export type LiveTurnState = "running" | "awaiting_approval";
export type LiveTurnContentPartKind = "thinking" | "text";

export type LiveTurnApproval = {
  requestId: string;
  toolName: string;
  toolCallId: string;
  reason?: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-request" | "never";
};

export type LiveTurnContentPart = {
  partId: string;
  kind: LiveTurnContentPartKind;
  text: string;
  sequence: number;
};

export type LiveTurnPartPatch = {
  partId: string;
  kind: LiveTurnContentPartKind;
  delta: string;
  sequence: number;
};

export type LiveTurnSnapshot = {
  nodeId: string;
  sessionId: string;
  turnId: string;
  operation: LiveTurnOperation;
  state: LiveTurnState;
  revision: number;
  assistantText: string;
  assistantThinking?: string;
  contentParts?: LiveTurnContentPart[];
  contentSequence?: number;
  approval?: LiveTurnApproval;
};

export type LiveTurnPatch = {
  type: "patch";
  nodeId: string;
  sessionId: string;
  turnId: string;
  operation: LiveTurnOperation;
  state: LiveTurnState;
  revision: number;
  sequenceStart: number;
  sequenceEnd: number;
  /** Compatibility alias for the end of the applied sequence range. */
  sequence: number;
  parts: LiveTurnPartPatch[];
  approval?: LiveTurnApproval;
};

export type LiveTurnEvent =
  | { type: "upsert"; snapshot: LiveTurnSnapshot }
  | LiveTurnPatch
  | { type: "replace"; nodeId: string; turnId: string; revision: number; snapshot: LiveTurnSnapshot }
  | { type: "remove"; nodeId: string; revision: number };
