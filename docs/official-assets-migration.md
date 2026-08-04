# 官方资产迁移说明

本轮只把能够证明来源、许可、依赖闭合和运行身份的定义迁入 Hub。Core 本地资产库与 Hub
远程资产库保持两份独立副本，通过稳定远程 ID、版本、提交和定义摘要关联。

## Definition 与 Core 覆盖层（Overlay）

助手定义包含运行身份、多语言名称和说明、规则、推荐提示、头像符号以及稳定远程技能依赖。
启用状态、排序、模型偏好、设备路径、配置值和密钥属于 Core 覆盖层，不进入 Hub。

助手技能依赖统一转换为
`tjuaeasset-skill-<name>/skill/<runtimeId>`。缺少独立来源证明的旧位图头像没有迁入；助手
使用可移植的 Unicode 头像符号。

## 已迁移

官方集合目前包含：

- 9 个助手：academic-paper、beautiful-mermaid、dashboard-creator、excel-creator、
  financial-model-creator、pitch-deck-creator、ppt-creator、word-creator、word-form-creator。
- 6 个技能：cron、mermaid、tjuaeui-config、tjuaeui-troubleshooting、
  tjuaeui-webui-setup、weixin-file-send。
- 1 个引擎适配器：codex。
- 1 个 MCP：mcp-everything。

每项资产都是独立 `tjuaeasset-*` 原子包。Codex 同时示范公开配置与私密配置的环境绑定，
只声明字段与变量名；实际值始终由 Core 加密保存并在会话启动时注入。

## 明确跳过

跳过不等于删除 Core 本地资产，也不会通过静默删依赖来拼出可发布资产。当前跳过项包括：

- 许可证禁止再分发或来源链不完整的内容。
- 依赖未锁定、缺少完整性记录或包含可变下载地址的技能。
- 包含用户目录、固定端口、持久浏览器配置或未审计自动发布行为的资产。
- 缺少规则所引用文件、上游修订、许可证或 NOTICE 的助手。

只有补齐真正上游、固定修订、许可归属、完整依赖和功能文件后，才能作为新的原子包进入
Hub。

## 官方信任与离线种子

官方包必须同时出现在信任策略和逐项 provenance 中，并与实际 Hub 路径、资产类型、
运行 ID、源修订及 Git tree/blob OID 一致。作者或发布者自报不能获得官方信任。

每次构建从完整 Index v2 选择当前可用官方资产，生成 `seed-manifest.json` 和内容寻址种子
ZIP。种子索引是完整索引的精确官方子集，嵌套包字节与独立分发包完全相同，并确定性覆盖
助手、引擎适配器、技能和 MCP 四类。
