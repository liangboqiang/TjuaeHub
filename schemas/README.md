# TjuaeHub 模式

只保留两个当前协议，不提供历史别名、回退解析或双写：

- `tjuae-skill.v1.schema.json`：本地和市场技能共用的唯一工作区清单。
- `skill-index.v1.schema.json`：静态市场索引；只含展示字段、Git 仓库、固定 revision、源码路径和摘要。

技能源码固定在 `skills/<slug>`，目录名必须等于清单 `id`。每项技能必须同时包含 `.tjuae-skill.json` 与 `SKILL.md`。清单保存版本、分类、启用、自动注入和来源；`SKILL.md` frontmatter 保存名称和说明，正文保存智能体指令。

索引不携带文件内容、归档、安装命令或生命周期钩子。Core 必须从固定 revision 读取源码，拒绝不安全路径、符号链接和摘要不匹配，然后把它转换为独立的本地 Git 工作区。
