// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDarwinRenderer, SettingsPanel, SURFACES, type SurfaceCtx } from "./surfaces";
import { TitlebarProvider } from "./titlebar/Titlebar";

const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "api");
  if (originalPlatform) Object.defineProperty(navigator, "platform", originalPlatform);
});

describe("ProjectPanel empty creation state", () => {
  it("opens the shared project dialog instead of mutating projects directly", async () => {
    const openCreateProject = vi.fn();
    const ctx = {
      projects: [], sessions: [], activeProjectId: null, activeSessionId: null,
      openCreateProject, createSession: vi.fn(), goSettings: vi.fn(), reloadSettings: vi.fn(),
      theme: "light", setActiveNodeId: vi.fn(), sessionMode: null, setSessionMode: vi.fn(),
      treeVersion: 0, bumpTreeVersion: vi.fn(), agentCount: 0, activitySessions: [], agents: [],
      activityStatus: null, activeSessionKey: null, setActiveSessionKey: vi.fn(), activityNow: 0,
      refreshActivityStatus: vi.fn(async () => undefined), runActivityConfig: vi.fn(async () => undefined), settings: null,
    } satisfies SurfaceCtx;
    const ProjectPanel = SURFACES.find((surface) => surface.id === "project")!.Panel;

    render(React.createElement(ProjectPanel, { ctx }));
    await userEvent.click(screen.getByRole("button", { name: "新建项目" }));

    expect(openCreateProject).toHaveBeenCalledOnce();
  });

  it("offers the shared creation action on startup before a topic is opened", async () => {
    const createSession = vi.fn();
    const ctx = {
      projects: [{ id: "project-1", name: "Project", createdAt: 1, updatedAt: 1, pinned: false, order: 0 }],
      sessions: [{ id: "session-1", projectId: "project-1", title: "A", createdAt: 1, updatedAt: 1, order: 0 }],
      activeProjectId: "project-1",
      activeSessionId: null,
      openCreateProject: vi.fn(), createSession, goSettings: vi.fn(), reloadSettings: vi.fn(),
      theme: "light", setActiveNodeId: vi.fn(), sessionMode: null, setSessionMode: vi.fn(),
      treeVersion: 0, bumpTreeVersion: vi.fn(), agentCount: 0, activitySessions: [], agents: [],
      activityStatus: null, activeSessionKey: null, setActiveSessionKey: vi.fn(), activityNow: 0,
      refreshActivityStatus: vi.fn(async () => undefined), runActivityConfig: vi.fn(async () => undefined), settings: null,
    } satisfies SurfaceCtx;
    const ProjectPanel = SURFACES.find((surface) => surface.id === "project")!.Panel;

    render(React.createElement(ProjectPanel, { ctx }));

    expect(screen.getByTestId("creation-empty-state")).toBeTruthy();
    expect(screen.queryByText("选择一个具体话题")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(createSession).toHaveBeenCalledOnce();
  });
});

describe("isDarwinRenderer", () => {
  it("does not treat a mac-like browser navigator as Electron Darwin", () => {
    Reflect.deleteProperty(window, "api");
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });

    expect(isDarwinRenderer()).toBe(false);
  });

  it("returns true only for an explicitly injected Electron Darwin platform", () => {
    window.api = { platform: "darwin" } as Window["api"];

    expect(isDarwinRenderer()).toBe(true);
  });

  it("returns false for an explicitly injected non-Darwin platform", () => {
    window.api = { platform: "win32" } as Window["api"];

    expect(isDarwinRenderer()).toBe(false);
  });
});

describe("SettingsPanel model registry", () => {
  it("renders model configuration with connected providers and configured default models only", async () => {
    const setSettings = vi.fn();
    window.api = {
      platform: "darwin",
      settings: {
        set: setSettings,
        setGlobalModel: vi.fn(),
        setPermissions: vi.fn(),
        addProviderModel: vi.fn(async () => ({ ok: true })),
        deleteProviderModel: vi.fn(async () => ({ ok: true })),
        openModelsJson: vi.fn(),
      },
      monitor: { setNotify: vi.fn() },
    } as unknown as Window["api"];
    const ctx = {
      projects: [],
      sessions: [],
      activeProjectId: null,
      activeSessionId: null,
      openCreateProject: vi.fn(),
      createSession: vi.fn(),
      goSettings: vi.fn(),
      reloadSettings: vi.fn(),
      theme: "light",
      setActiveNodeId: vi.fn(),
      sessionMode: "chat",
      setSessionMode: vi.fn(),
      treeVersion: 0,
      bumpTreeVersion: vi.fn(),
      agentCount: 0,
      activitySessions: [],
      agents: [],
      activityStatus: null,
      activeSessionKey: null,
      setActiveSessionKey: vi.fn(),
      activityNow: 0,
      refreshActivityStatus: vi.fn(async () => undefined),
      runActivityConfig: vi.fn(async () => undefined),
      settings: {
        access: { provider: "anthropic", baseUrl: "", model: "" },
        appearance: { theme: "system", density: "comfortable" },
        monitor: { notify: true },
        memory: { enabled: false, backgroundExtraction: false, autoDream: false, rootDir: "/legacy/custom/path" },
        modelRegistry: {
          providers: [
            {
              id: "anthropic",
              name: "Anthropic",
              source: "builtin",
              baseUrl: "https://api.anthropic.com/v1",
              availability: "available",
              diagnostics: [],
              hasAuthentication: true,
              hasPlaintextSecret: false,
              models: [
                {
                  id: "claude-sonnet-4-5",
                  providerId: "anthropic",
                  name: "Claude Sonnet 4.5",
                  api: "anthropic-messages",
                  source: "user-overridden",
                  availability: "available",
                  available: true,
                  diagnostics: [],
                  capabilities: { reasoning: true, images: true, contextWindow: 200000, maxOutputTokens: 64000 },
                },
                {
                  id: "claude-haiku-4-5",
                  providerId: "anthropic",
                  name: "Claude Haiku 4.5",
                  api: "anthropic-messages",
                  source: "user-overridden",
                  availability: "missing-authentication",
                  available: false,
                  diagnostics: [],
                  capabilities: { reasoning: false, images: true, contextWindow: 200000, maxOutputTokens: 32000 },
                },
              ],
            },
            {
              id: "google",
              name: "Google",
              source: "builtin",
              availability: "missing-authentication",
              diagnostics: [],
              hasAuthentication: false,
              hasPlaintextSecret: false,
              models: [],
            },
          ],
        },
        globalDefaultModel: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
        sources: { baseUrl: "default", model: "default", key: "none" },
        hasKey: false,
        keyStorage: "local",
        resolvedModel: "claude-sonnet-4-5",
        resolvedTheme: "light",
      },
    } satisfies SurfaceCtx;

    render(
      React.createElement(TitlebarProvider, {
        defaultDescriptor: { title: "fallback" },
        children: React.createElement(SettingsPanel, { ctx }),
      }),
    );

    expect(screen.getByRole("heading", { name: "模型配置" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "模型" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "连接" })).toBeNull();
    expect(screen.getByText("Anthropic")).toBeTruthy();
    expect(screen.getAllByText(/Claude Sonnet 4.5/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Google")).toBeNull();
    expect(screen.queryByRole("button", { name: "打开 models.json" })).toBeNull();
    expect(screen.queryByText("Markdown 根目录")).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "默认模型" }));
    expect(screen.getByRole("option", { name: /Claude Sonnet 4.5/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Claude Haiku 4.5/ })).toBeNull();
    expect(screen.queryByLabelText(/API Key/i)).toBeNull();
    await user.click(screen.getByRole("option", { name: /Claude Sonnet 4.5/ }));

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
      memory: { enabled: false, backgroundExtraction: false, autoDream: false },
    }));
    expect(setSettings.mock.calls[0]?.[0]?.memory).not.toHaveProperty("rootDir");
  });

  it("opens an add-model form with provider registry options and submits provider configuration", async () => {
    const addProviderModel = vi.fn(async () => ({ ok: true }));
    window.api = {
      platform: "darwin",
      settings: {
        set: vi.fn(),
        setGlobalModel: vi.fn(),
        addProviderModel,
        deleteProviderModel: vi.fn(async () => ({ ok: true })),
        openModelsJson: vi.fn(),
      },
      monitor: { setNotify: vi.fn() },
    } as unknown as Window["api"];
    const ctx = {
      projects: [],
      sessions: [],
      activeProjectId: null,
      activeSessionId: null,
      openCreateProject: vi.fn(),
      createSession: vi.fn(),
      goSettings: vi.fn(),
      reloadSettings: vi.fn(),
      theme: "light",
      setActiveNodeId: vi.fn(),
      sessionMode: "chat",
      setSessionMode: vi.fn(),
      treeVersion: 0,
      bumpTreeVersion: vi.fn(),
      agentCount: 0,
      activitySessions: [],
      agents: [],
      activityStatus: null,
      activeSessionKey: null,
      setActiveSessionKey: vi.fn(),
      activityNow: 0,
      refreshActivityStatus: vi.fn(async () => undefined),
      runActivityConfig: vi.fn(async () => undefined),
      settings: {
        access: { provider: "anthropic", baseUrl: "", model: "" },
        appearance: { theme: "system", density: "comfortable" },
        monitor: { notify: true },
        modelRegistry: {
          providers: [
            {
              id: "anthropic",
              name: "Anthropic",
              baseUrl: "https://api.anthropic.com/v1",
              source: "builtin",
              availability: "available",
              diagnostics: [],
              hasAuthentication: true,
              hasPlaintextSecret: false,
              models: [
                {
                  id: "claude-sonnet-4-5",
                  providerId: "anthropic",
                  name: "Claude Sonnet 4.5",
                  api: "anthropic-messages",
                  source: "builtin",
                  availability: "available",
                  available: true,
                  diagnostics: [],
                  capabilities: { reasoning: true, images: true, contextWindow: 200000, maxOutputTokens: 64000 },
                },
                {
                  id: "claude-haiku-4-5",
                  providerId: "anthropic",
                  name: "Claude Haiku 4.5",
                  api: "anthropic-messages",
                  source: "builtin",
                  availability: "available",
                  available: true,
                  diagnostics: [],
                  capabilities: { reasoning: false, images: true, contextWindow: 200000, maxOutputTokens: 32000 },
                },
              ],
            },
            {
              id: "google",
              name: "Google",
              source: "builtin",
              availability: "missing-authentication",
              diagnostics: [],
              hasAuthentication: false,
              hasPlaintextSecret: false,
              models: [],
            },
          ],
        },
        sources: { baseUrl: "default", model: "default", key: "none" },
        hasKey: false,
        keyStorage: "local",
        resolvedModel: "claude-sonnet-4-5",
        resolvedTheme: "light",
      },
    } satisfies SurfaceCtx;
    const user = userEvent.setup();

    render(
      React.createElement(TitlebarProvider, {
        defaultDescriptor: { title: "fallback" },
        children: React.createElement(SettingsPanel, { ctx }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    expect(screen.getByRole("option", { name: /Google/ })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: /Anthropic/ }));
    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
    const sonnet = screen.getByRole("checkbox", { name: /Claude Sonnet 4.5/ }) as HTMLInputElement;
    const haiku = screen.getByRole("checkbox", { name: /Claude Haiku 4.5/ }) as HTMLInputElement;
    expect(sonnet.checked).toBe(true);
    expect(haiku.checked).toBe(false);
    await user.click(haiku);
    expect(screen.queryByLabelText("Model name")).toBeNull();
    expect(screen.queryByLabelText("Context window")).toBeNull();
    expect(screen.queryByLabelText("Max output")).toBeNull();
    await user.click(screen.getByRole("button", { name: "保存模型" }));

    expect(addProviderModel).toHaveBeenCalledTimes(2);
    expect(addProviderModel).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        modelId: "claude-sonnet-4-5",
        modelName: "Claude Sonnet 4.5",
        api: "anthropic-messages",
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        images: true,
        modelFromProvider: true,
      }),
    );
    expect(addProviderModel).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        modelId: "claude-haiku-4-5",
        modelName: "Claude Haiku 4.5",
        api: "anthropic-messages",
        contextWindow: 200000,
        maxTokens: 32000,
        reasoning: false,
        images: true,
        modelFromProvider: true,
      }),
    );
  });

  it("edits and deletes an added model from the configured model list", async () => {
    const addProviderModel = vi.fn(async () => ({ ok: true }));
    const deleteProviderModel = vi.fn(async () => ({ ok: true }));
    window.api = {
      platform: "darwin",
      settings: {
        set: vi.fn(),
        setGlobalModel: vi.fn(),
        addProviderModel,
        deleteProviderModel,
        openModelsJson: vi.fn(),
      },
      monitor: { setNotify: vi.fn() },
    } as unknown as Window["api"];
    const ctx = {
      projects: [],
      sessions: [],
      activeProjectId: null,
      activeSessionId: null,
      openCreateProject: vi.fn(),
      createSession: vi.fn(),
      goSettings: vi.fn(),
      reloadSettings: vi.fn(),
      theme: "light",
      setActiveNodeId: vi.fn(),
      sessionMode: "chat",
      setSessionMode: vi.fn(),
      treeVersion: 0,
      bumpTreeVersion: vi.fn(),
      agentCount: 0,
      activitySessions: [],
      agents: [],
      activityStatus: null,
      activeSessionKey: null,
      setActiveSessionKey: vi.fn(),
      activityNow: 0,
      refreshActivityStatus: vi.fn(async () => undefined),
      runActivityConfig: vi.fn(async () => undefined),
      settings: {
        access: { provider: "anthropic", baseUrl: "", model: "" },
        appearance: { theme: "system", density: "comfortable" },
        monitor: { notify: true },
        modelRegistry: {
          providers: [
            {
              id: "openai",
              name: "OpenAI",
              baseUrl: "https://api.openai.com/v1",
              source: "builtin",
              availability: "available",
              diagnostics: [],
              hasAuthentication: true,
              hasPlaintextSecret: false,
              models: [
                {
                  id: "gpt-5.2",
                  providerId: "openai",
                  name: "GPT 5.2",
                  api: "openai-completions",
                  source: "user-custom",
                  availability: "available",
                  available: true,
                  diagnostics: [],
                  capabilities: { reasoning: true, images: false, contextWindow: 128000, maxOutputTokens: 16000 },
                },
              ],
            },
          ],
        },
        sources: { baseUrl: "default", model: "default", key: "none" },
        hasKey: false,
        keyStorage: "local",
        resolvedModel: "gpt-5.2",
        resolvedTheme: "light",
      },
    } satisfies SurfaceCtx;
    const user = userEvent.setup();

    render(
      React.createElement(TitlebarProvider, {
        defaultDescriptor: { title: "fallback" },
        children: React.createElement(SettingsPanel, { ctx }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("heading", { name: "编辑模型" })).toBeTruthy();
    expect(screen.queryByLabelText("Model name")).toBeNull();
    expect(screen.queryByLabelText("Context window")).toBeNull();
    expect(screen.queryByLabelText("Max output")).toBeNull();
    await user.clear(screen.getByLabelText("Base URL"));
    await user.type(screen.getByLabelText("Base URL"), "https://proxy.openai.test/v1");
    await user.click(screen.getByRole("button", { name: "保存模型" }));
    expect(addProviderModel).toHaveBeenCalledWith(expect.objectContaining({ providerId: "openai", modelId: "gpt-5.2", baseUrl: "https://proxy.openai.test/v1", maxTokens: 16000 }));

    await user.click(screen.getByRole("button", { name: "删除" }));
    const confirm = screen.getByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "删除" }));
    expect(deleteProviderModel).toHaveBeenCalledWith({ providerId: "openai", modelId: "gpt-5.2" });
  });

  it("opens the add-model dialog with provider registry options before any provider is connected", async () => {
    const addProviderModel = vi.fn(async () => ({ ok: true }));
    window.api = {
      platform: "darwin",
      settings: {
        set: vi.fn(),
        setGlobalModel: vi.fn(),
        addProviderModel,
        deleteProviderModel: vi.fn(async () => ({ ok: true })),
        openModelsJson: vi.fn(),
      },
      monitor: { setNotify: vi.fn() },
    } as unknown as Window["api"];
    const ctx = {
      projects: [],
      sessions: [],
      activeProjectId: null,
      activeSessionId: null,
      openCreateProject: vi.fn(),
      createSession: vi.fn(),
      goSettings: vi.fn(),
      reloadSettings: vi.fn(),
      theme: "light",
      setActiveNodeId: vi.fn(),
      sessionMode: "chat",
      setSessionMode: vi.fn(),
      treeVersion: 0,
      bumpTreeVersion: vi.fn(),
      agentCount: 0,
      activitySessions: [],
      agents: [],
      activityStatus: null,
      activeSessionKey: null,
      setActiveSessionKey: vi.fn(),
      activityNow: 0,
      refreshActivityStatus: vi.fn(async () => undefined),
      runActivityConfig: vi.fn(async () => undefined),
      settings: {
        access: { provider: "anthropic", baseUrl: "", model: "" },
        appearance: { theme: "system", density: "comfortable" },
        monitor: { notify: true },
        modelRegistry: {
          providers: [
            {
              id: "anthropic",
              name: "Anthropic",
              baseUrl: "https://api.anthropic.com/v1",
              source: "builtin",
              availability: "missing-authentication",
              diagnostics: [],
              hasAuthentication: false,
              hasPlaintextSecret: false,
              models: [
                {
                  id: "claude-sonnet-4-5",
                  providerId: "anthropic",
                  name: "Claude Sonnet 4.5",
                  api: "anthropic-messages",
                  source: "builtin",
                  availability: "missing-authentication",
                  available: false,
                  diagnostics: [],
                  capabilities: { reasoning: true, images: true, contextWindow: 200000, maxOutputTokens: 64000 },
                },
              ],
            },
            {
              id: "openai",
              name: "OpenAI",
              baseUrl: "https://api.openai.com/v1",
              source: "builtin",
              availability: "missing-authentication",
              diagnostics: [],
              hasAuthentication: false,
              hasPlaintextSecret: false,
              models: [
                {
                  id: "gpt-5.2",
                  providerId: "openai",
                  name: "GPT 5.2",
                  api: "openai-completions",
                  source: "builtin",
                  availability: "missing-authentication",
                  available: false,
                  diagnostics: [],
                  capabilities: { reasoning: true, images: true, contextWindow: 128000, maxOutputTokens: 16000 },
                },
              ],
            },
          ],
        },
        sources: { baseUrl: "default", model: "default", key: "none" },
        hasKey: false,
        keyStorage: "local",
        resolvedModel: "claude-sonnet-4-5",
        resolvedTheme: "light",
      },
    } satisfies SurfaceCtx;
    const user = userEvent.setup();

    render(
      React.createElement(TitlebarProvider, {
        defaultDescriptor: { title: "fallback" },
        children: React.createElement(SettingsPanel, { ctx }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "添加模型" }));

    expect(screen.getByRole("dialog", { name: "添加模型配置" })).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    expect(screen.getByRole("option", { name: "Anthropic · anthropic" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "OpenAI · openai" })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "OpenAI · openai" }));
    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
    expect(screen.getByText("GPT 5.2")).toBeTruthy();
    await user.type(screen.getByLabelText("API key"), "$OPENAI_API_KEY");
    await user.click(screen.getByRole("button", { name: "保存模型" }));

    expect(addProviderModel).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        modelId: "gpt-5.2",
        apiKey: "$OPENAI_API_KEY",
        modelFromProvider: true,
      }),
    );
  });
});
