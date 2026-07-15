import type { Edge, Node } from "@xyflow/react";

// A small research/learning branch tree: 理解 Transformer, then two branches
// (自注意力 / 位置编码), and a sub-branch (√dₖ 缩放) off the first.
export const initialNodes: Node[] = [
  {
    id: "root",
    type: "chatThread",
    position: { x: 400, y: 16 },
    data: {
      title: "理解 Transformer",
      model: "opus-4.8",
      messages: [
        { role: "user", text: "帮我快速讲讲 Transformer 的核心是什么。" },
        {
          role: "assistant",
          text: "核心是自注意力机制：每个 token 用 Query/Key/Value 计算与其他 token 的关联权重，从而捕捉长距离依赖。再叠加多头注意力并行看不同子空间、位置编码补上顺序信息，以及前馈层做非线性变换。",
        },
      ],
    },
  },
  {
    id: "a",
    type: "chatThread",
    position: { x: 96, y: 380 },
    data: {
      title: "自注意力怎么算",
      model: "opus-4.8",
      seed: { text: "自注意力机制", from: "理解 Transformer", parent: "root" },
      messages: [
        { role: "user", text: "自注意力具体是怎么算出来的？" },
        {
          role: "assistant",
          text: "Q = XWq，K = XWk，V = XWv。注意力权重 = softmax(QKᵀ / √dₖ)，再乘 V。直觉上就是「用 Query 去和每个 Key 打分，按分数加权汇总 Value」。",
        },
      ],
    },
  },
  {
    id: "b",
    type: "chatThread",
    position: { x: 720, y: 380 },
    data: {
      title: "为何要位置编码",
      model: "opus-4.8",
      seed: { text: "位置编码", from: "理解 Transformer", parent: "root" },
      messages: [
        { role: "user", text: "为什么需要位置编码？" },
        {
          role: "assistant",
          text: "自注意力本身对顺序不敏感（置换等变），把词序打乱结果一样。位置编码把「第几个位置」注入进去，模型才分得清语序。",
        },
      ],
    },
  },
  {
    id: "a1",
    type: "chatThread",
    position: { x: 96, y: 748 },
    data: {
      title: "√dₖ 的作用",
      model: "opus-4.8",
      mountAncestors: true,
      seed: { text: "softmax(QKᵀ / √dₖ)", from: "自注意力怎么算", parent: "a" },
      messages: [
        { role: "user", text: "为什么要除以 √dₖ？" },
        {
          role: "assistant",
          text: "dₖ 大时 QKᵀ 的方差会变大，softmax 掉进梯度极小的饱和区。除以 √dₖ 把方差拉回 ~1，训练更稳。",
        },
      ],
    },
  },
];

export const initialEdges: Edge[] = [
  { id: "e-root-a", source: "root", target: "a", label: "自注意力机制" },
  { id: "e-root-b", source: "root", target: "b", label: "位置编码" },
  { id: "e-a-a1", source: "a", target: "a1", label: "√dₖ 缩放" },
];
