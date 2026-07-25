import { Type } from "typebox";
import type { ReadonlyAgentTool } from "../../core/tool";
import { limitText, textResult } from "../../core/tool";

const FETCH_TIMEOUT_MS = 8000;
const FETCH_TEXT_LIMIT = 12_000;
const FETCH_READ_LIMIT = 128_000;

function isTextLike(contentType: string) {
  return /^(text\/|application\/(json|xml|xhtml\+xml|rss\+xml)|image\/svg\+xml)/i.test(contentType);
}

function stripHtml(input: string) {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createWebFetchTool(fetchImpl: typeof fetch = fetch): ReadonlyAgentTool<{ url: string }, unknown> {
  return {
    name: "web_fetch",
    label: "Fetch Web",
    description: "Fetch bounded readable text from an HTTP(S) URL.",
    parameters: Type.Object({
      url: Type.String({ description: "HTTP or HTTPS URL to fetch" }),
    }),
    readOnly: true,
    execute: async ({ args, signal }) => {
      const url = new URL(String(args.url ?? ""));
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP(S) URLs are supported");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      signal?.addEventListener("abort", () => controller.abort(), { once: true });
      try {
        const response = await fetchImpl(url, { signal: controller.signal, redirect: "follow" });
        const contentType = response.headers.get("content-type") ?? "";
        if (!isTextLike(contentType)) throw new Error(`Unsupported content type: ${contentType || "unknown"}`);

        const raw = await response.text();
        if (raw.length > FETCH_READ_LIMIT) throw new Error(`Response too large: ${raw.length} characters`);
        const readable = contentType.includes("html") ? stripHtml(raw) : raw;
        const limited = limitText(readable, FETCH_TEXT_LIMIT);
        return textResult(limited.text, {
          url: String(url),
          finalUrl: response.url,
          status: response.status,
          ok: response.ok,
          contentType,
          truncation: limited.truncation,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
