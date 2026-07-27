# 扩展清单模式

`extension-manifest.v1.schema.json` 是 TjuaeUI 唯一支持的扩展清单契约。
TjuaeHub 不为旧文件名、引擎键、包名前缀或环境变量提供别名。

每个 `contributes.*` 字段既可以内联声明，也可以通过 `$file:` 引用相对路径下的
`.json` 文件。引用路径必须使用正斜杠，且不得包含前导空白、绝对路径、Windows
盘符或 UNC 路径、反斜杠、空路径段以及 `..` 穿越路径段。
