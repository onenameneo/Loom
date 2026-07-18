import type { NodeLayout } from "./layout";

type ActiveResize = { token: number; nodeId: string; layout?: NodeLayout };

export class ResizeSession {
  private nextToken = 0;
  private active?: ActiveResize;
  private cancelled?: ActiveResize;

  start(nodeId: string): number {
    const token = ++this.nextToken;
    this.cancelled = undefined;
    this.active = { token, nodeId };
    return token;
  }

  update(token: number, nodeId: string, layout: NodeLayout): NodeLayout | undefined {
    if (!this.matches(token, nodeId)) return undefined;
    this.active!.layout = layout;
    return layout;
  }

  finish(token: number, nodeId: string, layout: NodeLayout): NodeLayout | undefined {
    if (!this.matches(token, nodeId)) return undefined;
    this.active = undefined;
    return layout;
  }

  cancel(): { token: number; nodeId: string; layout: NodeLayout } | undefined {
    const active = this.active;
    this.active = undefined;
    if (!active?.layout) return undefined;
    this.cancelled = active;
    return { token: active.token, nodeId: active.nodeId, layout: active.layout };
  }

  recover(token: number, nodeId: string): NodeLayout | undefined {
    if (this.cancelled?.token !== token || this.cancelled.nodeId !== nodeId) return undefined;
    return this.cancelled.layout;
  }

  isActive(): boolean {
    return Boolean(this.active);
  }

  private matches(token: number, nodeId: string): boolean {
    return this.active?.token === token && this.active.nodeId === nodeId;
  }
}
