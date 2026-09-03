# Loom

[中文](README.zh.md) · [English](README.md)

> A local Agent workbench that turns AI conversations into an explorable space for thinking.

Loom starts with a conversation and lets you split a question into branches, lay them out on a canvas, and continue exploring. It also brings together project files, Agent tools, long-term memory, and a local activity view for running Agents.

It is designed for research, learning, writing, coding, and any work that benefits from sustained thinking and parallel exploration.

<p align="center">
  <img src="assets/intro_0.gif" alt="Loom conversation interface and streaming response" width="720">
</p>

<p align="center">
  <img src="assets/intro_1.png" alt="Loom branching thought canvas" width="960">
</p>

## Core Features

### Conversation and Branching Canvas

- Streamed AI conversations with Markdown and code highlighting
- Select a passage from a response and start a new conversation branch
- Preserve branch lineage and switch between chat and canvas views
- Organize multiple sessions inside a project, with each session expanding into a thought graph
- Regenerate, edit and resend, continue conversations, and arrange the canvas manually

### Context and Session Management

Loom treats “what enters the next request” as a first-class capability instead of concatenating the entire conversation history every time.

- Start a branch from a selected passage to avoid carrying irrelevant context into a new question
- Manually attach ancestor context when a continuous line of investigation is needed
- Show context budget and token usage for each node
- Compact long sessions through structured checkpoints while preserving the original transcript
- Support manual compaction, automatic compaction, and context-overflow recovery
- Inspect context projections, budget diagnostics, and Agent lifecycles through Trace

### Agent Workflows

- Read, write, and edit files; run commands; calculate; and make network requests
- Build task plans, inspect tool timelines, and produce file artifacts
- Reference images, files, and project files in a conversation
- Use Skills and enable or disable them per branch
- Connect MCP Servers
- Keep tool calls behind permission and approval controls

### Agent Design Highlights

- Invoke tools on demand through a unified runtime for files, commands, calculations, network access, and MCP
- Apply output budgets and micro-compaction so a single oversized result does not consume the remaining context
- Track explicit lifecycle states for each Agent turn: start, execution, waiting, completion, failure, and cancellation
- Return tool failures, timeouts, and denials as structured results so the run can be inspected and continued
- Load Skills from global or project directories, with support for manual-only Skills to keep irrelevant instructions out of context
- Validate project scope, paths, and symbolic links before file access; request separate authorization for out-of-scope, network, and destructive operations
- Persist Trace and metrics for model calls, tool calls, compaction, and timing so a run can be debugged and reviewed

### Project File Workspace

- Organize files, sessions, and branches by project
- Browse project directories and search files
- Preview text, image, and code files
- Edit project files with Monaco Editor
- Keep Agent file access scoped to project directories

### Models and Providers

- Manage Providers, models, and authentication in Settings
- Use built-in model metadata, Models.dev catalog data, or custom models
- Support per-model context windows, reasoning capabilities, and image input capabilities
- Choose a different model and reasoning level for each branch

### Long-Term Memory and Local Agent Activity

- Store user preferences, project facts, and collaboration feedback as Markdown
- Support both user-level and project-level memories
- Review candidate memories before making them active
- Observe local Claude Code / Codex sessions as they run, wait, and complete
- Show an activity stream and desktop notifications without taking over running terminal sessions

## Reliability Foundations

Loom’s Agent capabilities are supported by a layered testing and validation harness covering context graphs, budget calculation, compaction, tool approvals, MCP, persistence, IPC, and renderer interactions.

- API keys, tool execution, and file access stay in the Electron main process
- The renderer is responsible for views and event subscriptions
- Tool arguments use structured contracts instead of concatenated shell strings
- Original long-session messages are stored in an append-only transcript
- Permissions, out-of-scope access, network access, and destructive operations can be approved separately

## Install and Run

### Download

Release packages will be available on GitHub Releases:

**[Download the latest release](https://github.com/onenameneo/Loom/releases)**

The current version is `v0.1.0` preview. Release packages are currently unsigned, so macOS and Windows may show a security warning on first launch.

### Run from Source

```bash
pnpm install
pnpm dev
```

After launch, add a Provider, model, and authentication details in Settings.

Common commands:

```bash
pnpm build       # Build the application code
pnpm typecheck   # Run strict type checking
pnpm test        # Run tests
pnpm dist:mac    # Build a macOS package
pnpm dist:win    # Build a Windows package
pnpm dist:linux  # Build a Linux package
```

Local build artifacts are written to `dist/`. For a release, push a Git tag such as `v0.1.0`; GitHub Actions will build platform artifacts and create a Draft Release automatically.

## Tech Stack

Electron · React · TypeScript · React Flow · pi-mono · SQLite · Monaco Editor · MCP

## Project Structure

```text
src/main/       Electron main process, Agent runtime, tools, MCP, memory, and persistence
src/preload/    Secure contextBridge API
src/renderer/   React UI, conversations, canvas, workspace, and settings
prototype/      Canvas visual prototype
```

## Related Project

[Loom Chat](https://github.com/onenameneo/dsh-plugin-loom-chat) is a DSH Web client plugin that turns linear sessions into a pannable, zoomable canvas for parallel exploration. It is a lightweight way to experience Loom-style branching inside DSH, with independent history, drafts, and runtime state for each branch.

## Project Status

Loom is currently in the `0.1.0` preview stage. Core conversations, project sessions, branching canvas, context management, Agent tools, MCP, long-term memory, and local Agent activity are integrated; UI details, cross-platform distribution, and broader Provider support are still being refined.
