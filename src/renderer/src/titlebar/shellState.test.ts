import { describe, expect, it } from "vitest";
import {
  completeShellTransition,
  createShellState,
  requestShellToggle,
} from "./shellState";

describe("shell state", () => {
  it("creates the expanded settled state when the sidebar is not persisted collapsed", () => {
    expect(createShellState(false)).toEqual({ phase: "expanded", version: 0 });
  });

  it("creates the collapsed settled state when the sidebar is persisted collapsed", () => {
    expect(createShellState(true)).toEqual({ phase: "collapsed", version: 0 });
  });

  it("requests collapse from expanded and settles on its matching completion", () => {
    const collapsing = requestShellToggle(createShellState(false), false);
    expect(collapsing).toEqual({ phase: "collapsing", version: 1 });

    expect(
      completeShellTransition(collapsing, {
        targetIsShell: true,
        propertyName: "--sidebar-width",
        version: 1,
      }),
    ).toEqual({ phase: "collapsed", version: 1 });
  });

  it("requests expansion from collapsed and settles on its matching completion", () => {
    const expanding = requestShellToggle(createShellState(true), false);
    expect(expanding).toEqual({ phase: "expanding", version: 1 });

    expect(
      completeShellTransition(expanding, {
        targetIsShell: true,
        propertyName: "--sidebar-width",
        version: 1,
      }),
    ).toEqual({ phase: "expanded", version: 1 });
  });

  it("uses a new version for every transition cycle and rejects the prior cycle completion", () => {
    const collapsing = requestShellToggle(createShellState(false), false);
    expect(collapsing).toEqual({ phase: "collapsing", version: 1 });

    const collapsed = completeShellTransition(collapsing, {
      targetIsShell: true,
      propertyName: "--sidebar-width",
      version: 1,
    });
    expect(collapsed).toEqual({ phase: "collapsed", version: 1 });

    const expanding = requestShellToggle(collapsed, false);
    expect(expanding).toEqual({ phase: "expanding", version: 2 });
    expect(
      completeShellTransition(expanding, {
        targetIsShell: true,
        propertyName: "--sidebar-width",
        version: 1,
      }),
    ).toBe(expanding);

    expect(
      completeShellTransition(expanding, {
        targetIsShell: true,
        propertyName: "--sidebar-width",
        version: 2,
      }),
    ).toEqual({ phase: "expanded", version: 2 });
  });

  it("ignores toggle requests while a collapse is already in progress", () => {
    const collapsing = requestShellToggle(createShellState(false), false);
    expect(requestShellToggle(collapsing, false)).toBe(collapsing);
  });

  it("ignores toggle requests while an expansion is already in progress", () => {
    const expanding = requestShellToggle(createShellState(true), false);
    expect(requestShellToggle(expanding, false)).toBe(expanding);
  });

  it("settles reduced-motion collapse immediately while advancing the version", () => {
    expect(requestShellToggle(createShellState(false), true)).toEqual({
      phase: "collapsed",
      version: 1,
    });
  });

  it("settles reduced-motion expansion immediately while advancing the version", () => {
    expect(requestShellToggle(createShellState(true), true)).toEqual({
      phase: "expanded",
      version: 1,
    });
  });

  it.each([
    {
      name: "stale version",
      completion: { targetIsShell: true, propertyName: "--sidebar-width", version: 0 },
    },
    {
      name: "non-shell target",
      completion: { targetIsShell: false, propertyName: "--sidebar-width", version: 1 },
    },
    {
      name: "wrong property",
      completion: { targetIsShell: true, propertyName: "opacity", version: 1 },
    },
  ])("rejects a $name completion without changing the transitional state", ({ completion }) => {
    const collapsing = requestShellToggle(createShellState(false), false);
    expect(completeShellTransition(collapsing, completion)).toBe(collapsing);
  });

  it.each([createShellState(false), createShellState(true)])(
    "rejects completion when already settled in $phase",
    (settled) => {
      expect(
        completeShellTransition(settled, {
          targetIsShell: true,
          propertyName: "--sidebar-width",
          version: settled.version,
        }),
      ).toBe(settled);
    },
  );
});
