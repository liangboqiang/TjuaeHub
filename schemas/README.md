# TjuaeHub 模式说明

本仓库只支持当前原子资产协议，不提供历史协议的回退解析。

## 模式清单

- `asset-package.v1.schema.json`：一个包、一项 typed asset 的纯声明清单。
- `assistant-definition.v1.schema.json`：可同步助手定义，不包含启用、排序、模型或本机状态。
- `engine-adapter-definition.v1.schema.json`：ACP 协议、可移植运行坐标、能力和配置字段。
- `mcp-definition.v1.schema.json`：stdio、SSE、streamable HTTP 传输、能力和配置字段。
- `hub-index.v2.schema.json`：远程市场唯一索引。
- `official-asset-provenance.v1.schema.json`：逐项官方来源与固定 Git 对象。
- `offline-seed-manifest.v1.schema.json`：内容寻址的四类官方离线种子清单。

## 包与资产身份

包目录名和 `name` 使用 `tjuaeasset-` 前缀。`assets` 数组恰好一项，资产的稳定远程 ID
由构建器组成：`<package>/<kind>/<localId>`。`runtimeId` 是 Core 投影到实际运行表时使用
的身份，不能用本地数据库 ID 替代。

Definition 入口按类型固定：

| kind            | definitionFile        |
| --------------- | --------------------- |
| `assistant`     | `assistant.json`      |
| `engineAdapter` | `engine-adapter.json` |
| `skill`         | `SKILL.md`            |
| `mcp`           | `mcp.json`            |

包依赖是排序且唯一的稳定远程资产 ID。正式索引拒绝缺失依赖、自引用、依赖环，以及官方
资产对非官方资产的依赖。

## 配置字段绑定

引擎与 MCP 的 `configurationSchema.fields[]` 每项都必须包含：

```json
{
  "key": "apiKey",
  "label": "API 密钥",
  "valueType": "string",
  "required": false,
  "secret": true,
  "binding": { "target": "environment", "name": "OPENAI_API_KEY" }
}
```

绑定约束：

- 引擎适配器：只允许 `environment`。
- stdio MCP：只允许 `environment`。
- SSE 与 streamable HTTP MCP：只允许 `header`。
- 绑定名称必须合法且在同一 Definition 中大小写不重复。

Definition 只声明绑定目标，绝不保存实际值。公开原子值、加密密钥、可执行路径、工作目录、
实例 URL 和启用状态属于 Core 覆盖层（Overlay）；Core 在会话启动时即时渲染并注入。
密钥不得进入参数、索引、分发包、日志或 Trace。

## 远程索引与信任

Index v2 的 `packages` 是原子分发单元，`assets` 是 Core 可浏览和同步的资产单元。
包路径固定为 `assets/<package>`，清单路径固定为
`assets/<package>/asset-package.json`。字段使用 camelCase。

`packages.reviewStatus` 的正式值为 `approved`；`assets.status` 为
`active | deprecated | revoked`。`revoked` 只能由仓库策略产生，Core 必须禁止安装和
更新。`trust` 只由 `policies/trust-policy.v1.json` 和逐项 provenance 生成，清单作者
无法自报提升。

## 安全边界

- 所有结构化对象关闭未知字段。
- 包禁止命令、安装脚本和生命周期钩子。
- 相对路径拒绝盘符、UNC、反斜杠、空路径段和路径穿越。
- 可移植定义拒绝字面量凭据、私有网络端点、本机绝对路径和实际环境/请求头值。
- npm 包坐标使用精确 SemVer；Hub 只分发声明，运行依赖由 Core 受控获取。
