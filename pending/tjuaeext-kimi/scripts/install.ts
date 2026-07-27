import { $ } from 'bun';

if (process.platform === 'win32') {
  throw new Error('Kimi Code CLI 暂不支持 Windows。最新信息请访问 https://www.kimi.com/code。');
}

await $`curl -L code.kimi.com/install.sh | bash`;
