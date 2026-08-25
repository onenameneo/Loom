# Loom 模型目录

Loom 的模型目录分成三层：pi-ai 自带模型是离线基线，Models.dev 提供可更新的 provider/model 元数据，用户配置保存在 `~/.loom/agent/models.json`。Models.dev 只负责目录信息，不保存或接收用户 API key。

## 数据归属与优先级

- pi-ai builtin：应用内置的已知模型，来源标记为 `pi-builtin`。
- Models.dev：从固定 HTTPS endpoint `https://models.dev/catalog.json` 拉取并归一化，缓存到 `~/.loom/agent/catalog/models-dev.json`，来源标记为 `models-dev`。
- user override：用户在 `models.json` 中对目录模型保存 provider endpoint、凭证引用和轻量 `modelOverrides`，覆盖同名目录元数据。
- user custom：用户手工输入的 provider/model，优先级最高。

刷新目录不会修改 `models.json`。目录请求使用超时、响应大小限制和 ETag；失败时继续使用最近一次有效缓存，缓存不存在时回退到 pi-ai 内置目录。

## 设置页行为

设置页的模型配置拆为 Provider 选择、认证/endpoint、目录模型选择、能力摘要、自定义模型表单和目录刷新按钮。目录模型的名称、协议、输入能力、上下文窗口和最大输出由目录只读提供；激活时只保存 provider 凭证/endpoint 和空的 `modelOverrides`，不会把远程完整元数据复制进 `models.json`。自定义模型仍由用户独立填写 API 类型、模型 ID、能力和限制。

目录模型只有在 provider 认证有效且 API 映射受 runtime allowlist 支持时才可用。Models.dev 中无法映射到当前 pi-ai adapter 的 provider 会显示诊断，不会被猜测成 OpenAI-compatible 请求。

## 迁移说明

旧版本中的 `builtin` 来源标签仍可读取，并在 renderer 中按目录模型处理；新写入的 pi-ai 内置来源使用 `pi-builtin`。全局默认模型仍保存为 `{ providerId, modelId }`，因此已有选择、checkpoint 和 node model reference 不需要迁移。
