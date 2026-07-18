import type { NodeLayout } from "./layout";

type ActiveResize = {
  token: number;
  nodeId: string;
  layout?: NodeLayout;
  hasUpdate: boolean;
};

export class ResizeSession {
  private nextToken = 0;
  private active?: ActiveResize;
  private cancelled?: ActiveResize;
  private canonical = new Map<string, NodeLayout>();

  start(nodeId: string, layout?: NodeLayout): number {
    const token = ++this.nextToken;
    this.cancelled = undefined;
    this.active = { token, nodeId, layout, hasUpdate: false };
    return token;
  }

  update(token: number, nodeId: string, layout: NodeLayout): NodeLayout | undefined {
    if (!this.matches(token, nodeId)) return undefined;
    this.active!.layout = layout;
    this.active!.hasUpdate = true;
    this.canonical.set(nodeId, layout);
    return layout;
  }

  finish(token: number, nodeId: string, layout: NodeLayout): NodeLayout | undefined {
    if (!this.matches(token, nodeId)) return undefined;
    const active = this.active!;
    this.active = undefined;
    if (!active.hasUpdate) return undefined;
    this.canonical.set(nodeId, layout);
    return layout;
  }

  cancel(): { token: number; nodeId: string; layout: NodeLayout } | undefined {
    const active = this.active;
    this.active = undefined;
    if (!active?.hasUpdate || !active.layout) return undefined;
    this.cancelled = active;
    return { token: active.token, nodeId: active.nodeId, layout: active.layout };
  }

  recover(token: number, nodeId: string): NodeLayout | undefined {
    if (this.cancelled?.token !== token || this.cancelled.nodeId !== nodeId) return undefined;
    return this.cancelled.layout;
  }

  accepts(token: number, nodeId: string): boolean {
    return this.matches(token, nodeId);
  }

  isActiveFor(nodeId: string): boolean {
    return this.active?.nodeId === nodeId;
  }

  canonicalLayout(nodeId: string): NodeLayout | undefined {
    return this.canonical.get(nodeId);
  }

  isActive(): boolean {
    return Boolean(this.active);
  }

  private matches(token: number, nodeId: string): boolean {
    return this.active?.token === token && this.active.nodeId === nodeId;
  }
}
