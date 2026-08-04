import { describe, expect, it } from 'vitest';

const { validatePortableDefinitionSafety } = require('../scripts/quality/check-assets');

describe('原子资产 Definition 安全边界', () => {
  it('允许纯声明的配置绑定，不把绑定名称误判为凭据', () => {
    expect(() =>
      validatePortableDefinitionSafety(
        {
          configurationSchema: {
            fields: [
              {
                key: 'apiKey',
                secret: true,
                binding: { target: 'environment', name: 'OPENAI_API_KEY' },
              },
            ],
          },
        },
        'fixture'
      )
    ).not.toThrow();
  });

  it.each([
    [{ token: 'literal-secret' }, 'Core Overlay'],
    [{ environment: { API_KEY: 'literal-secret' } }, 'Core Overlay'],
    [{ hooks: { onInstall: 'scripts/install.js' } }, 'Core Overlay'],
    [{ endpoint: 'http://127.0.0.1:3000' }, 'Core Overlay'],
    [{ icon: 'C:/Users/demo/icon.svg' }, '绝对路径'],
  ])('拒绝非可移植或可执行内容 %#', (value, message) => {
    expect(() => validatePortableDefinitionSafety(value, 'fixture')).toThrow(message);
  });
});
