import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 洋葱护栏：① 领域核心（agent/core）必须零基础设施依赖。
// 断言 core 源码不对 pi(值) / electron / better-sqlite3 / store / adapters 做值导入。
// 只允许 `import type ...`（编译期擦除）。这道测试防止核心纯度回潮。
// ---------------------------------------------------------------------------

const CORE_DIR = join(process.cwd(), "src/main/agent/core");

const IMPORT_RE = /import\s+(type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g;

/** 任何情形都不允许（core 根本不该碰）。 */
function forbiddenAlways(mod: string): boolean {
  return mod === "electron" || mod === "better-sqlite3" || /(^|\/)(store|adapters)(\/|$)/.test(mod);
}
/** 允许 `import type`，但禁止值导入。 */
function forbiddenAsValue(mod: string): boolean {
  return mod.startsWith("@mariozechner/");
}

function coreSourceFiles(): string[] {
  return readdirSync(CORE_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(CORE_DIR, f));
}

describe("agent/core 纯度护栏", () => {
  it("有源码文件可扫描", () => {
    expect(coreSourceFiles().length).toBeGreaterThan(0);
  });

  it("core 不对 pi/electron/sqlite/store/adapters 做值导入", () => {
    const violations: string[] = [];
    for (const file of coreSourceFiles()) {
      const src = readFileSync(file, "utf-8");
      for (const m of src.matchAll(IMPORT_RE)) {
        const isType = Boolean(m[1]);
        const mod = m[3];
        if (forbiddenAlways(mod)) violations.push(`${file}: 禁止依赖 "${mod}"`);
        else if (forbiddenAsValue(mod) && !isType) violations.push(`${file}: pi 只能 import type，发现值导入 "${mod}"`);
      }
    }
    expect(violations).toEqual([]);
  });
});
