import type { ClockPort, IdPort } from "../ports";

// ---------------------------------------------------------------------------
// ④ 适配器 · 运行时基元：系统时钟 + id 生成（等价原 canvas 的 Date.now / nextMessageId）。
// 抽成端口实现，让 ②/① 不直接摸 Date.now，也便于未来快照/重放。
// ---------------------------------------------------------------------------

export const systemClock: ClockPort = {
  now: () => Date.now(),
};

/** 创建 id 生成器：与原 canvas 的 seq 计数 + base36 时间戳编码一致。 */
export function createIds(clock: ClockPort = systemClock): IdPort {
  let seq = 0;
  return {
    message() {
      seq += 1;
      return `msg_${clock.now().toString(36)}_${seq.toString(36)}`;
    },
  };
}
