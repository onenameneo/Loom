// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const freshModule = async () => {
  vi.resetModules();
  return import("./slashHint");
};

describe("composer slash hint dismissal", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts undismissed on a clean profile", async () => {
    const { isSlashHintDismissed } = await freshModule();
    expect(isSlashHintDismissed()).toBe(false);
  });

  it("persists dismissal across module reloads", async () => {
    const first = await freshModule();
    first.dismissSlashHint();

    const second = await freshModule();
    expect(second.isSlashHintDismissed()).toBe(true);
  });

  it("notifies subscribers and keeps them in sync", async () => {
    const { dismissSlashHint, subscribeSlashHint } = await freshModule();
    const listener = vi.fn();
    const unsubscribe = subscribeSlashHint(listener);

    dismissSlashHint();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("is idempotent and does not re-notify after dismissal", async () => {
    const { dismissSlashHint, subscribeSlashHint } = await freshModule();
    const listener = vi.fn();
    const unsubscribe = subscribeSlashHint(listener);

    dismissSlashHint();
    dismissSlashHint();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
