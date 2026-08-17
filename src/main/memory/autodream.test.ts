import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTODREAM_MIN_INTERVAL_MS, AUTODREAM_MIN_SESSIONS, AutoDreamService, checkAutoDreamGates } from "./autodream";
import { MemoryStore } from "./storage";
import type { AutoDreamState } from "./autodream";

describe("AutoDream", () => {
  it("requires the feature, interval, session count and throttle gates", () => {
    const state: AutoDreamState = { version: 1, newSessions: AUTODREAM_MIN_SESSIONS, lastRunAt: 0, lastScanAt: AUTODREAM_MIN_INTERVAL_MS * 2 - 1_000 };
    expect(checkAutoDreamGates(state, { enabled: false, now: AUTODREAM_MIN_INTERVAL_MS * 2 }).reason).toBe("disabled");
    expect(checkAutoDreamGates({ ...state, newSessions: 0 }, { enabled: true, now: AUTODREAM_MIN_INTERVAL_MS * 2 }).reason).toBe("sessions");
    expect(checkAutoDreamGates(state, { enabled: true, now: AUTODREAM_MIN_INTERVAL_MS * 2 }).reason).toBe("throttled");
    expect(checkAutoDreamGates({ ...state, lastScanAt: 0 }, { enabled: true, now: AUTODREAM_MIN_INTERVAL_MS * 2 + 1_000_000 }).eligible).toBe(true);
  });

  it("runs observable phases without deleting memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-dream-"));
    let now = AUTODREAM_MIN_INTERVAL_MS * 2 + 20 * 60_000;
    const store = new MemoryStore({ rootDir: root, now: () => now });
    await store.writeOperationalState({ version: 1, newSessions: AUTODREAM_MIN_SESSIONS });
    const phases: string[] = [];
    const service = new AutoDreamService(store, () => now);
    const result = await service.run(true, (progress) => phases.push(progress.phase));
    expect(result?.status).toBe("completed");
    expect(phases).toEqual(["orient", "gather", "consolidate", "prune", "completed"]);
    expect((await store.stats()).archived).toBe(0);
  });
});
