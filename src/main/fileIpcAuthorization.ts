export function assertRendererSender(
  event: { sender: unknown },
  rendererWindow: { webContents: unknown; isDestroyed(): boolean } | null,
): void {
  if (!rendererWindow || rendererWindow.isDestroyed() || event.sender !== rendererWindow.webContents) {
    throw new Error("unauthorized file request");
  }
}
