import { $ } from 'bun';

if (process.platform === 'win32') {
  throw new Error('Kiro CLI 暂不支持 Windows。最新信息请访问 https://kiro.dev。');
}

await $`curl -fsSL https://cli.kiro.dev/install | bash`;
