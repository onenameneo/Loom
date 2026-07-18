import type { BrowserWindowConstructorOptions } from "electron";

export function platformWindowOptions(
  platform: NodeJS.Platform,
  dark: boolean,
): BrowserWindowConstructorOptions {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 16 },
      vibrancy: "sidebar",
      visualEffectState: "active",
      backgroundColor: "#00000000",
    };
  }
  if (platform === "win32") {
    return {
      backgroundMaterial: "mica",
      backgroundColor: dark ? "#181818" : "#ffffff",
    };
  }
  return { backgroundColor: dark ? "#181818" : "#ffffff" };
}
