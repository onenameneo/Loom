import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authJsonPath } from "./paths";
import { createJsonCredentialStore } from "./credentialStore";

const tempDirs: string[] = [];

describe("model credential store", () => {
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("persists OAuth credentials without exposing them through list", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-home-"));
    tempDirs.push(home);
    const store = createJsonCredentialStore(home);
    await store.modify("anthropic", async () => ({ type: "oauth", refresh: "refresh-token", access: "access-token", expires: Date.now() + 60_000 }));

    expect(await store.read("anthropic")).toMatchObject({ type: "oauth", refresh: "refresh-token" });
    expect(await store.list()).toEqual([{ providerId: "anthropic", type: "oauth" }]);
    expect(existsSync(authJsonPath(home))).toBe(true);
    expect(JSON.parse(readFileSync(authJsonPath(home), "utf8")).anthropic.access).toBe("access-token");
  });

  it("serializes concurrent writes for the same provider and supports logout", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-home-"));
    tempDirs.push(home);
    const store = createJsonCredentialStore(home);
    await Promise.all([
      store.modify("openai", async () => ({ type: "oauth", refresh: "r1", access: "a1", expires: 1 })),
      store.modify("openai", async (current) => ({ type: "oauth", refresh: current?.type === "oauth" ? `${current.refresh}-next` : "r2", access: "a2", expires: 2 })),
    ]);
    expect((await store.read("openai"))?.type).toBe("oauth");
    await store.delete("openai");
    expect(await store.read("openai")).toBeUndefined();
  });
});
