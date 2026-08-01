import type { Message } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "../../modelConfig/registry";
import { createRuntimeModelsFromRegistry } from "../../modelConfig/runtimeModels";
import { loadScopedModelSettings, resolveSelectedModel } from "../../modelConfig/scopes";

export interface RuntimeTitleGenerator {
  generate(input: { prompt: string; response?: string; signal?: AbortSignal }): Promise<string>;
}

export function createRuntimeTitleGenerator(deps: { loadRegistry: () => Promise<ModelRegistry> }): RuntimeTitleGenerator {
  return {
    async generate(input) {
      const registry = await deps.loadRegistry();
      const scoped = loadScopedModelSettings({});
      const selected = resolveSelectedModel({ registry, scoped });
      if (!selected.model || !selected.available) throw new Error(selected.diagnostic?.message || "Title model is unavailable.");
      const models = await createRuntimeModelsFromRegistry(registry);
      const model = models.getModel(selected.ref.providerId, selected.ref.modelId);
      if (!model) throw new Error(`Title model template not found: ${selected.ref.providerId}/${selected.ref.modelId}`);
      const stream = models.streamSimple(model, { messages: titleMessages(input) }, {
        signal: input.signal,
        maxTokens: 32,
      });
      const streamedText = collectStreamText(stream);
      const result = await stream.result();
      return cleanTitle(textFromResult(result) || await streamedText);
    },
  };
}

function titleMessages(input: { prompt: string; response?: string }): Message[] {
  return [
    {
      role: "user",
      content: [
        "请为下面这次思考会话生成一个简短中文标题。",
        "要求：只输出标题本身；不要引号；不要句号；不超过 18 个汉字或 32 个英文字符；保留关键对象、技术名词或交易品种。",
        `用户首问：${input.prompt}`,
        input.response?.trim() ? `助手首答摘要参考：${input.response.trim().slice(0, 800)}` : undefined,
      ].filter(Boolean).join("\n\n"),
      timestamp: 0,
    },
  ];
}

async function collectStreamText(stream: AsyncIterable<unknown>): Promise<string> {
  const chunks: string[] = [];
  for await (const event of stream) {
    const value = event as any;
    if (typeof value?.delta === "string" && (value.type === "text_delta" || value.type === "delta")) chunks.push(value.delta);
    else if (typeof value?.content === "string" && value.type === "text_end") chunks.push(value.content);
  }
  return chunks.join("");
}

function textFromResult(value: any): string {
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.outputText === "string") return value.outputText;
  const content = value?.message?.content ?? value?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text") return item.text ?? "";
        if (item?.type === "output_text") return item.text ?? "";
        if (typeof item?.text === "string") return item.text;
        return "";
      })
      .join("");
  }
  return "";
}

function cleanTitle(input: string): string {
  return input
    .trim()
    .replace(/^["'“‘「『《]+|["'”’」』》]+$/g, "")
    .replace(/[。.!！?？]+$/g, "")
    .trim();
}
