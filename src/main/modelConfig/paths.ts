import { join } from "node:path";

export function loomAgentDir(homeDir: string) {
  return join(homeDir, ".loom", "agent");
}

export function modelsJsonPath(homeDir: string) {
  return join(loomAgentDir(homeDir), "models.json");
}

export function authJsonPath(homeDir: string) {
  return join(loomAgentDir(homeDir), "auth.json");
}

export function globalSettingsPath(homeDir: string) {
  return join(loomAgentDir(homeDir), "settings.json");
}

export function modelsDevCatalogCachePath(homeDir: string) {
  return join(loomAgentDir(homeDir), "catalog", "models-dev.json");
}
