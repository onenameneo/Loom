import type { ModelRef } from "./types";

export function attributeModelError(error: unknown, ref: ModelRef): Error {
  const prefix = `[${ref.providerId}/${ref.modelId}]`;
  const base = error instanceof Error ? error : new Error(String(error));
  if (base.message.startsWith(prefix)) return base;
  const attributed = new Error(`${prefix} ${base.message}`);
  attributed.stack = base.stack;
  attributed.cause = base;
  return attributed;
}
