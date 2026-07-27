import { $ } from 'bun';

if (process.platform === 'win32') {
  throw new Error('Goose 不支持 Windows。手动安装方法请参阅 https://github.com/block/goose。');
}

const dir = process.env.TJUAE_AGENT_INSTALL_DIR;
if (!dir) {
  console.error('[安装] 未设置 TJUAE_AGENT_INSTALL_DIR');
  process.exit(1);
}

const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
const binaryUrl = `https://github.com/block/goose/releases/latest/download/goose-${platform}-${arch}`;
const binDir = `${dir}/bin`;
const binaryPath = `${binDir}/goose`;

console.log(`[安装] 正在从 ${binaryUrl} 下载 Goose……`);
try {
  await $`mkdir -p ${binDir}`;
  await $`curl -fsSL ${binaryUrl} -o ${binaryPath}`;
  await $`chmod +x ${binaryPath}`;
  console.log(`[安装] Goose 已安装到 ${binaryPath}`);
} catch {
  console.error('[安装] Goose 二进制文件下载失败');
  process.exit(1);
}
