import { useState } from "react";
import { Highlight, type Language } from "prism-react-renderer";
import { Check, Copy } from "lucide-react";
import { tokenTheme } from "./prismTheme";
import { useI18n } from "../i18n/I18nProvider";

// 代码块：顶部语言标签 + 复制按钮，正文用 prism-react-renderer 高亮（token 化主题）。
// 复制按钮加 nodrag：画布节点内点它不会误触发拖拽。
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const language = (lang || "text") as Language;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard 不可用时静默 */
    }
  };

  return (
    <div className="codeblock my-4 overflow-hidden rounded-loom-md border border-loom-code-border bg-loom-code-bg">
      <div className="codeblock__bar nodrag flex items-center justify-between border-b border-loom-code-border bg-loom-code-text/5 px-loom-3 py-loom-1">
        <span className="codeblock__lang font-loom-mono text-[10.5px] tracking-[0.3px] text-loom-muted">{lang || "text"}</span>
        <button className="codeblock__copy inline-flex items-center gap-loom-1 rounded-loom-sm border border-transparent bg-transparent px-[7px] py-[3px] text-[11px] text-loom-muted hover:bg-loom-code-text/8 hover:text-loom-text" onClick={copy} title={t("message.copyCode")}>
          {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <Highlight theme={tokenTheme} code={code} language={language}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre className="codeblock__pre m-0 overflow-x-auto px-[14px] py-loom-3 font-loom-mono text-[12px] leading-[1.6] text-loom-code-text [tab-size:2]">
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, k) => (
                  <span key={k} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
