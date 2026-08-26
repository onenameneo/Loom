import type { Api, Model } from "@earendil-works/pi-ai";

export type ModelAvailability = "available" | "missing-authentication" | "configuration-error";
export type ConfigSource = "pi-builtin" | "models-dev" | "user-overridden" | "user-custom" | "builtin";
export type ProviderAuthType = "api_key" | "oauth";

export interface ProviderAuthMethod {
  type: ProviderAuthType;
  label: string;
  isSubscription?: boolean;
  loginLabel?: string;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface ModelDiagnostic {
  code: string;
  message: string;
  field?: string;
}

export interface ModelCapabilities {
  reasoning: boolean;
  thinkingLevels: string[];
  images: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  compatibility?: unknown;
}

export interface RegistryModel {
  id: string;
  providerId: string;
  name: string;
  api: Api;
  baseUrl: string;
  headers?: Record<string, string>;
  source: ConfigSource;
  capabilities: ModelCapabilities;
  availability: ModelAvailability;
  available: boolean;
  diagnostics: ModelDiagnostic[];
  runtimeModel: Model<Api>;
}

export interface RegistryProvider {
  id: string;
  name: string;
  baseUrl?: string;
  source: ConfigSource;
  availability: ModelAvailability;
  diagnostics: ModelDiagnostic[];
  hasAuthentication: boolean;
  hasPlaintextSecret: boolean;
  authMethods?: ProviderAuthMethod[];
  configuredAuthTypes?: ProviderAuthType[];
  models: RegistryModel[];
}

export interface ProviderSecret {
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface RendererRegistryDTO {
  providers: Array<{
    id: string;
    name: string;
    baseUrl?: string;
    source: ConfigSource;
    availability: ModelAvailability;
    diagnostics: ModelDiagnostic[];
    hasAuthentication: boolean;
    hasPlaintextSecret: boolean;
    authMethods: ProviderAuthMethod[];
    configuredAuthTypes: ProviderAuthType[];
    models: Array<{
      id: string;
      providerId: string;
      name: string;
      api: string;
      source: ConfigSource;
      availability: ModelAvailability;
      available: boolean;
      diagnostics: ModelDiagnostic[];
      capabilities: ModelCapabilities;
    }>;
  }>;
}

export interface BuiltinCatalog {
  providers: RegistryProvider[];
}
