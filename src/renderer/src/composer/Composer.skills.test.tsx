// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

afterEach(() => cleanup());

describe("Composer active skills", () => {
  it("shows enabled skills inside the composer surface", () => {
    render(
      <Composer
        nodeId="node-1"
        value=""
        onChange={vi.fn()}
        busy={false}
        placeholder="Ask"
        canRegenerate={false}
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        onOpenPersona={vi.fn()}
        onClearNode={vi.fn()}
        onRegenerate={vi.fn()}
        onSetModel={vi.fn()}
        activeSkills={[
          {
            id: "mao-zedong-perspective",
            name: "mao-zedong-perspective",
            description: "Perspective",
            sourceScope: "global",
            sourcePath: "/skills/mao",
            hash: "abc",
            diagnostics: [],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("已启用 Skills")).toBeTruthy();
    expect(screen.getByText("mao-zedong-perspective")).toBeTruthy();
  });

  it("lets the user remove an enabled skill from the composer", () => {
    const remove = vi.fn();
    render(
      <Composer
        nodeId="node-1"
        value=""
        onChange={vi.fn()}
        busy={false}
        placeholder="Ask"
        canRegenerate={false}
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        onOpenPersona={vi.fn()}
        onClearNode={vi.fn()}
        onRegenerate={vi.fn()}
        onSetModel={vi.fn()}
        onDisableSkill={remove}
        activeSkills={[
          {
            id: "mao-zedong-perspective",
            name: "mao-zedong-perspective",
            description: "Perspective",
            sourceScope: "global",
            sourcePath: "/skills/mao",
            hash: "abc",
            diagnostics: [],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "停用 Skill mao-zedong-perspective" }));

    expect(remove).toHaveBeenCalledWith("mao-zedong-perspective");
  });
});
