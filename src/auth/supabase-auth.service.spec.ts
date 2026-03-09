import { UnauthorizedException } from '@nestjs/common';
import { SupabaseAuthService } from './supabase-auth.service';

type ConfigMap = Record<string, string | undefined>;

function createService(config: ConfigMap) {
  return new SupabaseAuthService({
    get: (key: string) => config[key],
  } as never);
}

describe('SupabaseAuthService', () => {
  const originalFetch = global.fetch;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('accepts signup response with nested user object', async () => {
    const service = createService({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_JWT_SECRET: 'real-jwt-secret',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        user: { id: 'user-1', email: 'NESTED@EXAMPLE.COM' },
      }),
    } as Response);

    await expect(service.signUp('test@example.com', 'pw')).resolves.toEqual({
      id: 'user-1',
      email: 'nested@example.com',
    });
  });

  it('accepts signup response with top-level id/email', async () => {
    const service = createService({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_JWT_SECRET: 'real-jwt-secret',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'user-2',
        email: 'TOPLEVEL@EXAMPLE.COM',
      }),
    } as Response);

    await expect(service.signUp('test@example.com', 'pw')).resolves.toEqual({
      id: 'user-2',
      email: 'toplevel@example.com',
    });
  });

  it('returns upstream message when signup response does not include user data', async () => {
    const service = createService({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_JWT_SECRET: 'real-jwt-secret',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: 'Email signups are disabled',
      }),
    } as Response);

    await expect(service.signUp('test@example.com', 'pw')).rejects.toThrow(
      'Email signups are disabled',
    );
  });

  it('verifies jwt via Supabase user API', async () => {
    const service = createService({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'verified-user-id',
        email: 'Verified@Example.com',
      }),
    } as Response);

    await expect(service.verifyJwt('any-token')).resolves.toEqual({
      sub: 'verified-user-id',
      email: 'verified@example.com',
    });
  });

  it('fails jwt verification with upstream message from Supabase user API', async () => {
    const service = createService({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        message: 'JWT expired',
      }),
    } as Response);

    await expect(service.verifyJwt('any-token')).rejects.toThrow(UnauthorizedException);
    await expect(service.verifyJwt('any-token')).rejects.toThrow('JWT expired');
  });
});
