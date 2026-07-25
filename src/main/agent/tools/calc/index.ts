import { Type } from "typebox";
import type { ReadonlyAgentTool } from "../../core/tool";
import { textResult } from "../../core/tool";

type Token = { type: "num"; value: number } | { type: "op"; value: string } | { type: "paren"; value: "(" | ")" };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let raw = "";
      while (i < expression.length && /[0-9.]/.test(expression[i])) raw += expression[i++];
      if (!/^(?:\d+\.?\d*|\.\d+)$/.test(raw)) throw new Error(`Invalid number: ${raw}`);
      tokens.push({ type: "num", value: Number(raw) });
      continue;
    }
    if ("+-*/^".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      i++;
      continue;
    }
    throw new Error(`Unsupported character: ${ch}`);
  }
  return tokens;
}

export function evaluateArithmetic(expression: string): number {
  const tokens = tokenize(expression);
  let pos = 0;

  function peek() {
    return tokens[pos];
  }
  function consume() {
    return tokens[pos++];
  }
  function parseExpression(): number {
    let left = parseTerm();
    while (peek()?.type === "op" && (peek() as any).value.match(/^[+-]$/)) {
      const op = consume().value;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number {
    let left = parsePower();
    while (peek()?.type === "op" && (peek() as any).value.match(/^[*/]$/)) {
      const op = consume().value;
      const right = parsePower();
      if (op === "/" && right === 0) throw new Error("Division by zero");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function parsePower(): number {
    let left = parseUnary();
    if (peek()?.type === "op" && (peek() as any).value === "^") {
      consume();
      left = left ** parsePower();
    }
    return left;
  }
  function parseUnary(): number {
    if (peek()?.type === "op" && ((peek() as any).value === "+" || (peek() as any).value === "-")) {
      const op = consume().value;
      const value = parseUnary();
      return op === "-" ? -value : value;
    }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const token = consume();
    if (!token) throw new Error("Unexpected end of expression");
    if (token.type === "num") return token.value;
    if (token.type === "paren" && token.value === "(") {
      const value = parseExpression();
      const end = consume();
      if (end?.type !== "paren" || end.value !== ")") throw new Error("Missing closing parenthesis");
      return value;
    }
    throw new Error("Expected number or parenthesized expression");
  }

  const value = parseExpression();
  if (pos !== tokens.length) throw new Error("Unexpected trailing input");
  if (!Number.isFinite(value)) throw new Error("Result is not finite");
  return value;
}

export function createCalcTool(): ReadonlyAgentTool<{ expression: string }, { expression: string; result?: number }> {
  return {
    name: "calc",
    label: "Calculate",
    description: "Evaluate a restricted arithmetic expression using +, -, *, /, ^, and parentheses.",
    parameters: Type.Object({
      expression: Type.String({ description: "Arithmetic expression, for example: (2 + 3) * 4" }),
    }),
    readOnly: true,
    execute: async ({ args }) => {
      const expression = String(args.expression ?? "");
      if (!expression.trim()) throw new Error("Expression is required");
      const result = evaluateArithmetic(expression);
      return textResult(`${expression} = ${result}`, { expression, result });
    },
  };
}
