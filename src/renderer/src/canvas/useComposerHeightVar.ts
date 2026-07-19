import { useLayoutEffect, type RefObject } from "react";

// 悬浮输入框的共用测量胶水：观察 `measuredRef`（composer / foot）的实时高度，
// 把它作为 --composer-h 回填到 `hostRef` 上，滚动区据此留出底部空间，
// 让消息滚到输入框下方并在渐隐里淡出。ChatView 与画布节点卡片共用同一份逻辑。
export function useComposerHeightVar(
  measuredRef: RefObject<HTMLElement | null>,
  hostRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const measured = measuredRef.current;
    const host = hostRef.current;
    // 测试环境（jsdom）无 ResizeObserver；缺失时静默跳过，尺寸走 CSS 兜底值。
    if (!measured || !host || typeof ResizeObserver === "undefined") return;
    // 直接取 ResizeObserver 已算好的 border-box 高度，避免读 offsetHeight 触发同步重排。
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? measured.offsetHeight;
      host.style.setProperty("--composer-h", `${h}px`);
    });
    ro.observe(measured);
    return () => ro.disconnect();
  }, [measuredRef, hostRef]);
}
