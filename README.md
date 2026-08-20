# TjuaeHub

TjuaeHub 是 Tjuae 默认的远程官方资源市场。它只保存可审阅的技能、助手源码和由源码确定性生成的静态索引；不分发 CLI、MCP 服务器、安装脚本、ZIP 或离线种子，也不参与运行时配置。

## 极简结构

```text
skills/<slug>/       技能源码；必须包含 _meta.json 与 SKILL.md
assistants/<slug>/   助手源码；必须包含 _meta.json 与默认规则文件
schemas/             当前唯一清单和市场索引 Schema
scripts/             校验与确定性索引构建
dist/skills.json     技能分发索引
dist/assistants.json 助手分发索引
```

TjuaeCore 读取 `dist/skills.json`，按索引中的固定 Git revision 获取用户选定的准确版本并校验摘要。启用远程技能时只物化到私有运行缓存，不复制到“我的技能”；只有用户明确执行“复制到我的技能”时才创建可编辑副本。

TjuaeCore 以相同方式读取 `dist/assistants.json`。助手公共包只声明规则、推荐默认值和技能、MCP、模型、智能体依赖；启用状态、本机资源绑定、凭据、路径和缓存状态始终留在用户本机。启用助手前由 TjuaeCore 检查各类依赖，由用户逐类型、逐项确认，TjuaeHub 不替用户修改本机配置。

## 外部市场

外部来源由 TjuaeCore 的薄只读目录适配器提供。TjuaeHub 不包含第三方客户端、安装器、ZIP 或兼容字段；不同来源之间不做版本比较。

## 本地验证

```bash
bun install --frozen-lockfile
bun run verify
```

构建产物不得手工编辑。发布时只更新 `dist/skills.json` 与 `dist/assistants.json`。
