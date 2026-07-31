// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlashPalette } from "./SlashPalette";
import type { CmdCtx } from "./commands";

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

function ctx(): CmdCtx {
  return {
    nodeId: "node-1",
    insertText: vi.fn(),
    attachImage: vi.fn(),
    openPersona: vi.fn(),
    clearNode: vi.fn(),
    regenerate: vi.fn(),
    setModel: vi.fn(),
    compact: vi.fn(),
    getState: () => ({ canRegenerate: false }),
  };
}

describe("SlashPalette model command", () => {
  it("does not offer arbitrary custom model switching outside configured models", () => {
    render(
      React.createElement(SlashPalette, {
        value: "/model missing",
        setValue: vi.fn(),
        ctx: ctx(),
        modelOptions: [{ id: "openai/gpt-5.2", name: "GPT 5.2" }],
      }),
    );

    expect(screen.queryByRole("option", { name: /missing/ })).toBeNull();
  });

  it("keyboard-selects a skill without rewriting unrelated composer text", async () => {
    const enableSkill = vi.fn();
    const setValue = vi.fn();
    (window as any).api = {
      canvas: {
        skills: vi.fn(async () => ({
          catalog: {
            activeSkills: [
              { id: "research", name: "Research", description: "Research helper", sourceId: "global:/skills", scope: "global", hash: "abc" },
            ],
          },
        })),
      },
    };
    render(
      React.createElement(SlashPalette, {
        value: "/skill re",
        setValue,
        ctx: { ...ctx(), enableSkill },
        modelOptions: [],
      }),
    );

    await waitFor(() => expect(screen.getByRole("option", { name: /Research/ })).toBeTruthy());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });

    expect(enableSkill).toHaveBeenCalledWith("research");
    expect(setValue).toHaveBeenCalledWith("");
  });

  it("runs the compact command from the slash palette", () => {
    const compact = vi.fn();
    const setValue = vi.fn();
    render(
      React.createElement(SlashPalette, {
        value: "/compact",
        setValue,
        ctx: { ...ctx(), compact },
        modelOptions: [],
      }),
    );

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });

    expect(compact).toHaveBeenCalledOnce();
    expect(setValue).toHaveBeenCalledWith("");
  });
});
