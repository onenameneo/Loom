// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlashPalette } from "./SlashPalette";
import type { CmdCtx } from "./commands";

afterEach(() => cleanup());

function ctx(): CmdCtx {
  return {
    nodeId: "node-1",
    insertText: vi.fn(),
    attachImage: vi.fn(),
    toggleMount: vi.fn(),
    openPersona: vi.fn(),
    clearNode: vi.fn(),
    regenerate: vi.fn(),
    setModel: vi.fn(),
    getState: () => ({ mount: false, canRegenerate: false }),
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
});
