set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]

default: verify

# 安装锁定版本的依赖。
install:
    bun install --frozen-lockfile

# 格式化受版本控制的源码和文档。
format:
    bun run format

# 构建正式分发目录。
build:
    bun run build

# 运行测试。
test:
    bun run test

# 执行与 CI 相同的完整门禁。
verify:
    bun run verify

# 通过完整门禁后再推送；额外参数会原样传给 git push。
push *ARGS: verify
    git push {{ ARGS }}
