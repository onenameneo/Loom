import type { ModelDiagnostic } from "./types";

export interface ResolvedValue {
  value?: string;
  plaintext: boolean;
  diagnostics: ModelDiagnostic[];
}

function isNameStart(ch: string) {
  return /[A-Za-z_]/.test(ch);
}

function isNamePart(ch: string) {
  return /[A-Za-z0-9_]/.test(ch);
}

export function resolveConfigValue(raw: unknown, field: string, env: NodeJS.ProcessEnv = process.env): ResolvedValue {
  if (raw === undefined || raw === null || raw === "") return { value: undefined, plaintext: false, diagnostics: [] };
  if (typeof raw !== "string") {
    return {
      plaintext: false,
      diagnostics: [{ code: "invalid-value", field, message: `${field} must be a string.` }],
    };
  }
  if (raw.startsWith("!")) {
    return {
      plaintext: false,
      diagnostics: [
        { code: "unsupported-command", field, message: `${field} uses unsupported command execution syntax.` },
      ],
    };
  }

  let output = "";
  let usedInterpolation = false;
  const diagnostics: ModelDiagnostic[] = [];

  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index];
    if (ch !== "$") {
      output += ch;
      continue;
    }

    const next = raw[index + 1];
    if (next === "$" || next === "!") {
      output += next;
      index += 1;
      continue;
    }

    if (next === "{") {
      const end = raw.indexOf("}", index + 2);
      if (end === -1) {
        output += ch;
        continue;
      }
      const name = raw.slice(index + 2, end);
      usedInterpolation = true;
      const value = env[name];
      if (!value) diagnostics.push({ code: "missing-env", field, message: `${field} references unset ${name}.` });
      output += value || "";
      index = end;
      continue;
    }

    if (next && isNameStart(next)) {
      let end = index + 2;
      while (end < raw.length && isNamePart(raw[end])) end += 1;
      const name = raw.slice(index + 1, end);
      usedInterpolation = true;
      const value = env[name];
      if (!value) diagnostics.push({ code: "missing-env", field, message: `${field} references unset ${name}.` });
      output += value || "";
      index = end - 1;
      continue;
    }

    output += ch;
  }

  return { value: output, plaintext: raw.replace(/\$[A-Za-z_][A-Za-z0-9_]*|\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, "").length > 0, diagnostics };
}
