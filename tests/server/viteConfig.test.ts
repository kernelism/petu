// @vitest-environment node
import { describe, it, expect } from 'vitest';
import config from '../../vite.config';

describe('vite.config', () => {
  it('serves nothing from .petu/ and keeps Vite\'s default fs.deny list', () => {
    const deny = (config as { server?: { fs?: { deny?: string[] } } }).server?.fs?.deny ?? [];
    expect(deny).toEqual(expect.arrayContaining(['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.petu/**']));
  });
});
