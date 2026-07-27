/**
 * 用于开发和测试的本地 Hub 索引服务器。
 *
 * 提供 dist/ 目录，使 TjuaeUI 可从本机而不是 GitHub CDN 获取 index.json
 * 和扩展 ZIP。
 *
 * 用法：
 *   bun run kits/server/index.ts                  # 默认端口 3456
 *   bun run kits/server/index.ts --port 8080      # 自定义端口
 *
 * 然后使用以下命令启动 TjuaeUI：
 *   TJUAE_HUB_URL=http://localhost:3456/ bun run start
 */

import path from 'node:path';

const DEFAULT_PORT = 3456;

function parsePort(): number {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1 && process.argv[idx + 1]) {
    const port = Number(process.argv[idx + 1]);
    if (Number.isFinite(port) && port > 0) return port;
  }
  return DEFAULT_PORT;
}

const port = parsePort();
const distDir = path.resolve(import.meta.dir, '..', '..', 'dist');

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    console.log(`${req.method} ${url.pathname}`);
    const filePath = path.join(distDir, url.pathname);

    // 防止目录穿越
    if (!filePath.startsWith(distDir)) {
      return new Response('禁止访问', { status: 403 });
    }

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response('未找到', { status: 404 });
  },
});

console.log(`Hub 开发服务器正在运行：http://localhost:${server.port}/`);
console.log(`服务目录：${distDir}`);
console.log(`\n使用以下命令启动 TjuaeUI：\n  TJUAE_HUB_URL=http://localhost:${server.port}/ bun run start`);
