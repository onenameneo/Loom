import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

export type MsgRole = "user" | "assistant" | "error" | "tool";
export type Density = "compact" | "comfortable";

// react-markdown 组件覆盖：围栏代码块 → CodeBlock（高亮/复制），行内 code → token 化，
// 链接 → 新窗口（经主进程 window-open handler 走系统浏览器）。不启用 rehype-raw（转义 HTML）。
const mdComponents = {
  pre: (props: any) => <>{props.children}</>,
  code: ({ className, children }: any) => {
    const match = /language-(\w+)/.exec(className || "");
    const raw = String(children ?? "");
    if (match || raw.includes("\n")) {
      return <CodeBlock code={raw.replace(/\n$/, "")} lang={match?.[1]} />;
    }
    return <code className="inline-code">{children}</code>;
  },
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

// 共用消息组件：画布节点与 ChatView 都用它。助手消息渲染 Markdown，其余纯文本。
export function Message({
  role,
  text,
  density = "comfortable",
  streaming = false,
}: {
  role: MsgRole;
  text: string;
  density?: Density;
  streaming?: boolean;
}) {
  return (
    <div className={`m m--${role} m--${density}`}>
      {role === "assistant" ? (
        <div className="m__md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {text}
          </ReactMarkdown>
          {streaming && <span className="m__caret" />}
        </div>
      ) : (
        <span className="m__plain">{text}</span>
      )}
    </div>
  );
}
