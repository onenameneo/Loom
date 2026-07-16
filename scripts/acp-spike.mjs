#!/usr/bin/env node
import { spawn } from "node:child_process";
import { basename, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
} from "@agentclientprotocol/sdk";

const cwd = resolve(process.argv[2] || process.cwd());
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(npx, ["-y", "@zed-industries/claude-code-acp"], {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

child.stderr?.setEncoding("utf8");
child.stderr?.on("data", (chunk) => {
  process.stderr.write(`[adapter stderr] ${chunk}`);
});
child.on("exit", (code, signal) => {
  console.log(`[adapter exit] code=${code ?? ""} signal=${signal ?? ""}`);
});

function cancelled() {
  return { outcome: { outcome: "cancelled" } };
}

const client = {
  async requestPermission(params) {
    console.log("[permission]", JSON.stringify(params, null, 2));
    return cancelled();
  },
  async sessionUpdate(params) {
    console.log("[sessionUpdate]", JSON.stringify(params, null, 2));
  },
  async readTextFile(params) {
    console.log("[readTextFile]", JSON.stringify(params, null, 2));
    return { content: "" };
  },
  async writeTextFile(params) {
    console.log("[writeTextFile]", JSON.stringify(params, null, 2));
    return {};
  },
};

async function main() {
  if (!child.stdin || !child.stdout) throw new Error("adapter stdio unavailable");
  const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  const conn = new ClientSideConnection(() => client, stream);

  console.log(`[spike] cwd=${cwd} project=${basename(cwd)}`);
  const init = await conn.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
    },
  });
  console.log("[initialize]", JSON.stringify(init, null, 2));

  const session = await conn.newSession({ cwd, mcpServers: [] });
  console.log("[newSession]", JSON.stringify(session, null, 2));

  const prompt = await conn.prompt({
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "say hi" }],
  });
  console.log("[prompt]", JSON.stringify(prompt, null, 2));
}

main()
  .catch((error) => {
    console.error("[spike error]", error?.stack || error);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
  });
