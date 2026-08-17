# TjuaeHub

TjuaeHub 是 Tjuae 默认的远程官方技能市场。它只保存可审阅的技能源码和一份由源码确定性生成的静态索引；不分发 CLI、MCP 服务器、安装脚本、ZIP 或离线种子，也不参与技能运行。

## 极简结构

```text
skills/<slug>/       技能源码；必须包含 .tjuae-skill.json 与 SKILL.md
schemas/             当前唯一清单和市场索引 Schema
scripts/             校验与确定性索引构建
dist/skills.json     唯一分发产物
```

TjuaeCore 读取 `dist/skills.json` 后，从索引指定的固定 Git revision 和 `skills/<slug>` 路径物化源码、校验摘要，再创建独立的本地 Git 仓库。TjuaeUI 和智能体只使用该本地工作区；断网不会影响已经安装的技能。

## 外部市场

其他市场若原样实现 `schemas/skill-index.v1.schema.json`，可作为额外只读索引。没有该索引的来源不需要适配：Git 仓库走通用克隆，本地目录走通用导入。TjuaeHub 不包含任何第三方市场专用客户端或字段映射器。

## 本地验证

```bash
bun install --frozen-lockfile
bun run verify
```

构建产物不得手工编辑。发布时只复制 `dist/skills.json`。
