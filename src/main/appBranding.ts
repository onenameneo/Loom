import { join } from "path";

export const PRODUCT_NAME = "Loom";

// 打包应用由原生 app bundle 提供图标；开发态直接指向仓库中的发布源图标。
export function developmentIconPath(cwd: string, isPackaged: boolean): string | undefined {
  return isPackaged ? undefined : join(cwd, "build", "icon.png");
}
