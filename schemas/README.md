# TjuaeHub 模式

只保留两个当前协议，不提供历史别名、回退解析或双写：

- `tjuae-skill.v1.schema.json`：公共技能包中 `_meta.json` 的唯一 Schema。
- `skill-index.v1.schema.json`：静态市场索引；包含展示字段、版本列表、固定 Git revision、源码路径和摘要。
- `tjuae-assistant.v1.schema.json`：公共助手包中 `_meta.json` 的唯一 Schema。
- `assistant-index.v1.schema.json`：助手静态索引；包含展示字段、版本、固定 Git revision、文件与摘要。

技能源码固定在 `skills/<slug>`，目录名必须等于清单 `id`。每项技能必须同时包含 `_meta.json` 与 `SKILL.md`。`_meta.json` 只保存公共协议数据；启用、自动加入新助手、来源、本地路径、Git 和缓存状态属于用户运行数据，禁止写入公共技能包。

助手源码固定在 `assistants/<slug>`，目录名必须等于清单 `id`。`_meta.json` 只描述助手定义、推荐默认值和资源要求；启用状态、资源绑定、凭据、本机路径、Git 与缓存状态禁止写入公共助手包。

索引不携带文件内容、归档、安装命令或生命周期钩子。Core 必须从固定 revision 读取源码，拒绝不安全路径、符号链接和摘要不匹配；运行缓存与“我的技能”始终分离。
