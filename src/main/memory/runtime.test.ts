import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTODREAM_MIN_SESSIONS } from "./autodream";
import { createMemoryRuntime } from "./runtime";

describe("memory runtime gates", () => {
  it("does not schedule the extractor when background extraction is off", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-runtime-"));
    const settings = { enabled: true, backgroundExtraction: false, autoDream: false, rootDir: undefined };
    let calls = 0;
    const runtime = createMemoryRuntime({
      homeDir: home,
      settings: () => settings,
      extractor: { run: async () => { calls += 1; return []; } },
    });
    await runtime.afterTurn({ sessionId: "s1", nodeId: "n1", userText: "I prefer English." });
    expect(calls).toBe(0);
    settings.backgroundExtraction = true;
    await runtime.afterTurn({ sessionId: "s1", nodeId: "n1", userText: "I prefer English.", sourceKey: "turn-2" });
    expect(calls).toBe(1);
  });

  it("keeps explicit remember and forget commands deterministic", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-runtime-"));
    const settings = { enabled: true, backgroundExtraction: false, autoDream: false, rootDir: undefined };
    const runtime = createMemoryRuntime({ homeDir: home, settings: () => settings });
    const remembered = await runtime.handleCommand("/remember user Neo is the user", { sessionId: "s1", nodeId: "n1" });
    expect(remembered).toMatchObject({ handled: true, ok: true, record: { status: "active" } });
    const forgotten = await runtime.handleCommand(`/forget ${remembered.record!.id}`, { sessionId: "s1", nodeId: "n1" });
    expect(forgotten).toMatchObject({ handled: true, ok: true, record: { status: "archived" } });
  });

  it("keeps AutoDream independently available when extraction is off", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-runtime-"));
    const settings = { enabled: true, backgroundExtraction: false, autoDream: true, rootDir: undefined };
    const runtime = createMemoryRuntime({ homeDir: home, settings: () => settings });
    await runtime.store.writeOperationalState({ version: 1, newSessions: AUTODREAM_MIN_SESSIONS });
    const result = await runtime.maybeRunAutoDream();
    expect(result?.status).toBe("completed");
  });
});
