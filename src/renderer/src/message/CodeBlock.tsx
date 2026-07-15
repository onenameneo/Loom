import { useState } from "react";
import { Highlight, type Language } from "prism-react-renderer";
import { Check, Copy } from "lucide-react";
import { tokenTheme } from "./prismTheme";

// 代码块：顶部语言标签 + 复制按钮，正文用 prism-react-renderer 高亮（token 化主题）。
// 复制按钮加 nodrag：画布节点内点它不会误触发拖拽。
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
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
    <div className="codeblock">
      <div className="codeblock__bar nodrag">
        <span className="codeblock__lang">{lang || "text"}</span>
        <button className="codeblock__copy" onClick={copy} title="复制代码">
          {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <Highlight theme={tokenTheme} code={code} language={language}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre className="codeblock__pre">
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
