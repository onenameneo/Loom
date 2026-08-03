import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { signWithElectronOsxSign } = require("../../scripts/mac-sign.cjs") as {
  signWithElectronOsxSign: (
    options: { app: string; identity: string; identityValidation: boolean },
    packager: object,
    loadOsxSign: () => { signAsync: (options: unknown) => Promise<void> },
  ) => Promise<void>;
};

describe("mac signing bridge", () => {
  it("configures electron-builder to use the fingerprint-preserving signer", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
    );

    expect(packageJson.build.mac.sign).toBe("scripts/mac-sign.cjs");
  });

  it("keeps the builder-provided fingerprint when a packager is supplied", async () => {
    const options = {
      app: "/tmp/Loom.app",
      identity: "B4654BB66B02D883649285995A7B9219353D5F4D",
      identityValidation: false,
    };
    const signAsync = vi.fn(async () => undefined);

    await expect(
      signWithElectronOsxSign(options, {}, () => ({ signAsync })),
    ).resolves.toBeUndefined();
    expect(signAsync).toHaveBeenCalledWith(options);
  });
});
