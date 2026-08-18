export const TODO_PLAN_LIMITS = {
  maxItems: 32,
  maxContentLength: 240,
  maxResultLength: 480,
  maxDependenciesPerItem: 8,
  maxPayloadLength: 24_000,
} as const;

export type TodoItemStatus = "pending" | "in_progress" | "completed" | "blocked";
export type TodoPlanStatus = "active" | "completed" | "blocked" | "cleared";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoItemStatus;
  dependsOn?: string[];
  result?: string;
}

export interface TodoPlanSnapshot {
  planId: string;
  nodeId: string;
  sessionId: string;
  turnId: string;
  revision: number;
  status: TodoPlanStatus;
  todos: TodoItem[];
  updatedAt: number;
}

export interface TodoPlanEventPayload {
  nodeId: string;
  sessionId: string;
  turnId: string;
  revision: number;
  snapshot: TodoPlanSnapshot;
}

export interface TodoPlanInput {
  nodeId: string;
  sessionId: string;
  turnId: string;
  planId: string;
  revision: number;
  todos: TodoItem[];
  updatedAt: number;
}

export type TodoPlanValidation =
  | { ok: true; todos: TodoItem[] }
  | { ok: false; error: string };

function boundedString(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= limit ? text : undefined;
}

export function validateTodoItems(value: unknown): TodoPlanValidation {
  if (!Array.isArray(value)) return { ok: false, error: "todos must be an array" };
  if (value.length > TODO_PLAN_LIMITS.maxItems) return { ok: false, error: `todo list exceeds ${TODO_PLAN_LIMITS.maxItems} items` };

  const rawIds = new Set<string>();
  const todos: TodoItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "todo item must be an object" };
    const item = raw as Record<string, unknown>;
    const id = boundedString(item.id, 80);
    const content = boundedString(item.content, TODO_PLAN_LIMITS.maxContentLength);
    const status = item.status;
    if (!id || !content) return { ok: false, error: "todo item requires bounded id and content" };
    if (rawIds.has(id)) return { ok: false, error: `duplicate todo id: ${id}` };
    if (status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "blocked") {
      return { ok: false, error: `invalid todo status for ${id}` };
    }
    const dependsOn = item.dependsOn === undefined
      ? undefined
      : Array.isArray(item.dependsOn)
        ? [...new Set(item.dependsOn.map((dep) => boundedString(dep, 80)).filter((dep): dep is string => Boolean(dep)))]
        : undefined;
    if (item.dependsOn !== undefined && (!dependsOn || dependsOn.length > TODO_PLAN_LIMITS.maxDependenciesPerItem)) {
      return { ok: false, error: `invalid dependencies for ${id}` };
    }
    const result = item.result === undefined ? undefined : boundedString(item.result, TODO_PLAN_LIMITS.maxResultLength);
    if (item.result !== undefined && !result) return { ok: false, error: `invalid result for ${id}` };
    rawIds.add(id);
    todos.push({
      id,
      content,
      status,
      ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
      ...(result ? { result } : {}),
    });
  }

  for (const item of todos) {
    if (item.dependsOn?.some((dep) => !rawIds.has(dep))) return { ok: false, error: `unknown dependency for ${item.id}` };
  }
  if (JSON.stringify(todos).length > TODO_PLAN_LIMITS.maxPayloadLength) return { ok: false, error: "todo payload is too large" };
  return { ok: true, todos };
}

export function deriveTodoPlanStatus(todos: readonly TodoItem[]): TodoPlanStatus {
  if (todos.length > 0 && todos.every((item) => item.status === "completed")) return "completed";
  if (todos.some((item) => item.status === "blocked")) return "blocked";
  return "active";
}

export function createTodoPlan(input: TodoPlanInput): { ok: true; snapshot: TodoPlanSnapshot } | { ok: false; error: string } {
  const validation = validateTodoItems(input.todos);
  if (!validation.ok) return validation;
  if (!input.planId || !input.nodeId || !input.sessionId || !input.turnId || !Number.isInteger(input.revision) || input.revision < 1) {
    return { ok: false, error: "invalid todo plan identity" };
  }
  const snapshot: TodoPlanSnapshot = {
    planId: input.planId,
    nodeId: input.nodeId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    revision: input.revision,
    status: deriveTodoPlanStatus(validation.todos),
    todos: validation.todos,
    updatedAt: input.updatedAt,
  };
  return { ok: true, snapshot };
}

export function clearTodoPlan(input: Omit<TodoPlanInput, "todos" | "planId"> & { planId?: string }): TodoPlanSnapshot {
  return {
    planId: input.planId ?? `plan-${input.turnId}`,
    nodeId: input.nodeId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    revision: input.revision,
    status: "cleared",
    todos: [],
    updatedAt: input.updatedAt,
  };
}

export function isTodoPlanStale(input: { currentTurnId?: string; currentGeneration?: number; turnId: string; generation: number; settled?: boolean; invalidated?: boolean }): boolean {
  return input.currentTurnId !== input.turnId || input.currentGeneration !== input.generation || input.settled === true || input.invalidated === true;
}
