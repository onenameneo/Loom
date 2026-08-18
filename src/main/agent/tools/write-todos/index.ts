import { Type } from "typebox";
import type { AgentTool, ToolExecutionContext, ToolResult } from "../../core/tool";
import { textResult } from "../../core/tool";
import type { TodoItem } from "../../core/todoPlan";

export type WriteTodosArgs = { todos: TodoItem[] };

export function createWriteTodosTool(
  update: (args: WriteTodosArgs, ctx: ToolExecutionContext<WriteTodosArgs>) => Promise<ToolResult> | ToolResult,
): AgentTool<WriteTodosArgs> {
  return {
    name: "write_todos",
    label: "Write todos",
    description: "Create or update the current execution plan. Use this for multi-step work and keep statuses current.",
    parameters: Type.Object({
      todos: Type.Array(Type.Object({
        id: Type.String({ minLength: 1, maxLength: 80 }),
        content: Type.String({ minLength: 1, maxLength: 240 }),
        status: Type.Union([
          Type.Literal("pending"),
          Type.Literal("in_progress"),
          Type.Literal("completed"),
          Type.Literal("blocked"),
        ]),
        dependsOn: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 8 })),
        result: Type.Optional(Type.String({ maxLength: 480 })),
      }), { maxItems: 32 }),
    }),
    readOnly: true,
    executionMode: "sequential",
    async execute(ctx) {
      try { return await update(ctx.args, ctx); }
      catch (error) {
        return textResult(`write_todos failed: ${error instanceof Error ? error.message : String(error)}`, { error: String(error) }, true);
      }
    },
  };
}
