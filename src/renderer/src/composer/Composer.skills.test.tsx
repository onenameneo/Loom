// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

afterEach(() => cleanup());

describe("Composer active skills", () => {
  it("requests a draft-aware context preview for the current attachments and skills", async () => {
    const budget = vi.fn(async () => ({ safeInputBudget: 1_000, projectedInputTokens: 100, status: "ok", source: "estimated" }));
    (window as any).api = { canvas: { budget, models: vi.fn(async () => []) } };
    render(
      <Composer
        nodeId="node-1"
        value="draft prompt"
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
        onCompact={vi.fn()}
        activeSkills={[{ id: "skill-a", name: "Skill A", description: "A", sourceScope: "global", sourcePath: "/a", hash: "a", diagnostics: [] }]}
      />,
    );

    await waitFor(() => expect(budget).toHaveBeenCalledWith("node-1", expect.objectContaining({ text: "draft prompt", skillIds: ["skill-a"] })));
  });

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
        onCompact={vi.fn()}
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
        onCompact={vi.fn()}
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

describe("Composer thinking level control", () => {
  afterEach(() => {
    delete (window as any).api;
  });

  it("defaults a reasoning model to its first enabled thinking level when unset", async () => {
    (window as any).api = {
      canvas: {
        models: vi.fn(async () => [
          {
            id: "openai/gpt-5.5",
            name: "GPT 5.5",
            providerId: "openai",
            modelId: "gpt-5.5",
            capabilities: { reasoning: true, thinkingLevels: ["off", "low", "medium", "high"] },
          },
        ]),
      },
    };

    render(
      <Composer
        nodeId="node-1"
        value=""
        onChange={vi.fn()}
        busy={false}
        placeholder="Ask"
        canRegenerate={false}
        model="openai/gpt-5.5"
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        onOpenPersona={vi.fn()}
        onClearNode={vi.fn()}
        onRegenerate={vi.fn()}
        onSetModel={vi.fn()}
        onCompact={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", { name: /openai\/gpt-5.5 · low/ })).toBeTruthy();
  });

  it("selects the first enabled thinking level when switching to a reasoning model", async () => {
    const setThinkingLevel = vi.fn();
    const setModel = vi.fn();
    (window as any).api = {
      canvas: {
        models: vi.fn(async () => [
          {
            id: "local/fast",
            name: "Fast",
            providerId: "local",
            modelId: "fast",
            capabilities: { reasoning: false, thinkingLevels: ["off"] },
          },
          {
            id: "openai/gpt-5.5",
            name: "GPT 5.5",
            providerId: "openai",
            modelId: "gpt-5.5",
            capabilities: { reasoning: true, thinkingLevels: ["off", "low", "medium"] },
          },
        ]),
      },
    };

    render(
      <Composer
        nodeId="node-1"
        value=""
        onChange={vi.fn()}
        busy={false}
        placeholder="Ask"
        canRegenerate={false}
        model="local/fast"
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        onOpenPersona={vi.fn()}
        onClearNode={vi.fn()}
        onRegenerate={vi.fn()}
        onSetModel={setModel}
        onSetThinkingLevel={setThinkingLevel}
        onCompact={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /local\/fast · off/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /GPT 5.5/ }));

    expect(setModel).toHaveBeenCalledWith("openai/gpt-5.5");
    expect(setThinkingLevel).toHaveBeenCalledWith("low");
  });

  it("combines model and thinking level in one configuration menu", async () => {
    const setThinkingLevel = vi.fn();
    const setModel = vi.fn();
    (window as any).api = {
      canvas: {
        models: vi.fn(async () => [
          {
            id: "openai/gpt-5.5",
            name: "GPT 5.5",
            providerId: "openai",
            modelId: "gpt-5.5",
            capabilities: { reasoning: true, thinkingLevels: ["off", "low", "medium", "high"] },
          },
          {
            id: "openai/gpt-5.5-mini",
            name: "GPT 5.5 Mini",
            providerId: "openai",
            modelId: "gpt-5.5-mini",
            capabilities: { reasoning: true, thinkingLevels: ["off", "low", "medium"] },
          },
        ]),
      },
    };

    render(
      <Composer
        nodeId="node-1"
        value=""
        onChange={vi.fn()}
        busy={false}
        placeholder="Ask"
        canRegenerate={false}
        model="openai/gpt-5.5"
        thinkingLevel="medium"
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        onOpenPersona={vi.fn()}
        onClearNode={vi.fn()}
        onRegenerate={vi.fn()}
        onSetModel={setModel}
        onSetThinkingLevel={setThinkingLevel}
        onCompact={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Thinking medium" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /openai\/gpt-5.5 · medium/ }));
    expect(screen.getByRole("group", { name: "Models" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Thinking" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /GPT 5.5 Mini/ }));
    expect(setModel).toHaveBeenCalledWith("openai/gpt-5.5-mini");
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("slider", { name: /Thinking medium/ }), { key: "ArrowRight" });

    expect(setThinkingLevel).toHaveBeenCalledWith("high");
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("keeps thinking disabled for a model without reasoning support", async () => {
    (window as any).api = {
      canvas: {
        models: vi.fn(async () => [
          {
            id: "local/fast",
            name: "Fast",
            providerId: "local",
            modelId: "fast",
            capabilities: { reasoning: false, thinkingLevels: ["off"] },
          },
        ]),
      },
    };

    render(
      <Composer
        nodeId="node-1"
        value=""
        onChange={vi.fn()}
        busy={false}
        placeholder="Ask"
        canRegenerate={false}
        model="local/fast"
        thinkingLevel="medium"
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        onOpenPersona={vi.fn()}
        onClearNode={vi.fn()}
        onRegenerate={vi.fn()}
        onSetModel={vi.fn()}
        onSetThinkingLevel={vi.fn()}
        onCompact={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Thinking off" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /local\/fast · off/ }));
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByRole("slider", { name: /Thinking off/ }).hasAttribute("data-disabled")).toBe(true);
  });
});
