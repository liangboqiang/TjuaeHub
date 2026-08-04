# TjuaeHub 项目规范

本文档适用于所有人类贡献者和 AI 智能体。修改仓库前应先阅读本规范。

## 项目职责

TjuaeHub 是 Tjuae 的远程资产库，负责助手、引擎适配器、技能与 MCP 四类原子资产的
定义（Definition）、模式、审核、索引和确定性分发。它不承载 TjuaeUI、TjuaeCore 或
TjuaeCLI 的运行时代码，也不是 Core 本地资产库。

主要目录：

- `assets/`：审核通过并参与正式分发的原子资产包。
- `submissions/`：尚未进入正式分发的待审原子资产包。
- `schemas/`：唯一受支持的资产包、四类定义、索引与离线种子模式。
- `policies/`：构建器维护的信任与官方来源策略；包作者不得覆盖。
- `kits/`：本地浏览和验证工具。
- `scripts/quality/`：品牌、契约、安全和构建产物门禁。
- `tests/`：模式、构建、信任与安全行为测试。

## 原子资产契约

- 包目录必须使用 `tjuaeasset-` 前缀，清单文件只能命名为 `asset-package.json`。
- 每个包必须只声明一项 `assistant | engineAdapter | skill | mcp` 资产。
- 规范入口分别为 `assistant.json`、`engine-adapter.json`、`SKILL.md`、`mcp.json`。
- 清单与定义只包含纯声明数据；禁止贡献扩展、命令和安装或激活生命周期钩子。
- 依赖使用稳定远程资产 ID：`<package>/<kind>/<localId>`，必须排序、唯一且无环。
- 不得为已经删除的历史协议增加别名、回退解析或双写路径。
- 相对路径统一使用正斜杠，并拒绝绝对路径、盘符、UNC、反斜杠、空路径段、
  前导空白和 `..` 路径穿越。

## Definition 与 Core 覆盖层（Overlay）

- 引擎和 MCP 定义只声明固定版本的可移植包坐标、参数、能力和配置字段。
- 每个配置字段必须显式声明 `binding: { target, name }`。
- 引擎只允许绑定环境变量；stdio MCP 只允许绑定环境变量；SSE/HTTP MCP 只允许绑定请求头。
- 公开值、账号、密钥、实际环境变量/请求头值、本机路径、实例 URL 和启用状态只属于 Core
  覆盖层（Overlay），不得进入 Hub 包、索引、日志或离线种子。
- Hub 包不得静默下载或执行第三方代码；运行依赖由 Core 的受控流程获取。

## 品牌、安全与文案

- 产品身份统一使用 `Tjuae`、`TjuaeUI` 和 `TjuaeHub`。
- Tjuae 自有资产使用 `Tjuae` 作者身份；第三方资产必须保留真实 `author` 与可核验来源。
- 信任只由 `policies/trust-policy.v1.json` 与逐项 provenance 生成，清单自报无效。
- 面向用户的说明和错误使用简体中文；命令、协议字段和第三方产品专名保持原样。
- 不得加入广告、赞助、推广、字面量凭据、私有端点或无法核验的官方背书。
- 构建产物必须可由源码确定性重建；不要手工编辑 `dist/`。

## 验证

完成改动后执行：

```bash
just verify
```

该命令委托给 `bun run verify`，必须通过格式、品牌、资产契约、四类官方资产、Index v2、
安全、类型、测试、构建与 `dist/` 校验。任何一步失败都属于阻断问题。

## 提交

- 提交信息使用约定式提交格式：`<type>(<scope>): <subject>`。
- 不提交密钥、临时目录、依赖缓存或本地构建残留。
- 不添加 AI 署名或 `Co-Authored-By`。
- 未经用户明确授权不得暂存、提交或推送。
