#!/usr/bin/env node

// Codex hook -> Loom collector 转发器。
//
// 契约来自 https://learn.chatgpt.com/docs/hooks，有三条硬约束：
//
// 1. 载荷是 stdin 上的单个 JSON 对象（不是命令行参数）。
// 2. stdout 会被 Codex 当作 developer context 注入模型上下文，必须保持全空。
//    诊断信息一律走 stderr。
// 3. `async` 选项「解析但跳过」，即本进程是同步阻塞在 agent 回合里的。
//    Loom 不在跑、端口换了、collector 卡住 —— 任何一种都不能拖住用户的 codex。
//    所以这里自带硬超时，且无论如何 exit 0。
//
// port/token 从运行时文件读取，而不是像老的 notify 转发器那样从 argv 拿：
// Codex 按「命令字符串的哈希」记账信任（新的或改过的 hook 会被标记待审并跳过），
// 参数里带 port/token 意味着端口探测到 31578 或 token 轮换后哈希就变，
// 用户得重新去 /hooks 里信任一次。命令保持恒定，才能信任一次、终身有效。

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENDPOINT_FILE = join(homedir(), ".loom", "collector.json");
const POST_TIMEOUT_MS = 1_500;
const MAX_STDIN_BYTES = 1024 * 1024;

function readEndpoint() {
  try {
    const parsed = JSON.parse(readFileSync(ENDPOINT_FILE, "utf-8"));
    const port = Number(parsed?.port);
    const token = typeof parsed?.token === "string" ? parsed.token : "";
    if (!Number.isInteger(port) || port <= 0 || !token) return null;
    return { port, token };
  } catch {
    return null;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    process.stdin.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_STDIN_BYTES) {
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main() {
  const endpoint = readEndpoint();
  if (!endpoint) return;

  const raw = await readStdin();
  if (!raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  await fetch(`http://127.0.0.1:${endpoint.port}/codex`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
}

main()
  .catch(() => {
    // Loom 关着、端口变了、collector 无响应 —— 都不该让 codex 的回合失败。
  })
  .finally(() => {
    process.exit(0);
  });
