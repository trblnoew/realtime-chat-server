import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

type VerifiedJwt = {
  sub: string;
  email?: string | null;
};

type AuthUser = {
  id: string;
  email: string;
};

type SignInResult = {
  accessToken: string;
  refreshToken?: string;
  user: AuthUser;
};

@Injectable()
export class SupabaseAuthService {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly mockEnabled: boolean;

  private readonly mockUsers = new Map<
    string,
    { id: string; email: string; password: string }
  >();

  constructor(private readonly configService: ConfigService) {
    this.supabaseUrl = String(this.configService.get('SUPABASE_URL') || '').trim();
    this.supabaseAnonKey = String(this.configService.get('SUPABASE_ANON_KEY') || '').trim();
    this.mockEnabled =
      String(this.configService.get('SUPABASE_AUTH_MOCK') || '').toLowerCase() ===
        'true' || process.env.NODE_ENV === 'test';
  }

  async signUp(email: string, password: string): Promise<AuthUser> {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');
    if (!normalizedEmail || !normalizedPassword) {
      throw new BadRequestException('email and password are required');
    }

    if (this.mockEnabled) {
      if (this.mockUsers.has(normalizedEmail)) {
        throw new BadRequestException('User already registered');
      }
      const user = { id: randomUUID(), email: normalizedEmail, password: normalizedPassword };
      this.mockUsers.set(normalizedEmail, user);
      return { id: user.id, email: user.email };
    }

    this.ensureSupabaseRuntime();
    const response = await fetch(`${this.supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        apikey: this.supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: normalizedEmail,
        password: normalizedPassword,
      }),
    });
    const payload = await this.readJson(response);
    if (!response.ok) {
      throw new BadRequestException(
        payload?.error_description || payload?.msg || payload?.message || 'Signup failed',
      );
    }
    const user = payload?.user ?? payload;
    if (!user?.id || !user?.email) {
      throw new BadRequestException(
        payload?.error_description ||
          payload?.msg ||
          payload?.message ||
          'Signup response missing user',
      );
    }
    return { id: String(user.id), email: String(user.email).toLowerCase() };
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');
    if (!normalizedEmail || !normalizedPassword) {
      throw new BadRequestException('email and password are required');
    }

    if (this.mockEnabled) {
      const user = this.mockUsers.get(normalizedEmail);
      if (!user || user.password !== normalizedPassword) {
        throw new UnauthorizedException('Invalid login credentials');
      }
      return {
        accessToken: this.createMockAccessToken(user),
        user: { id: user.id, email: user.email },
      };
    }

    this.ensureSupabaseRuntime();
    const response = await fetch(
      `${this.supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          apikey: this.supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password: normalizedPassword,
        }),
      },
    );
    const payload = await this.readJson(response);
    if (!response.ok) {
      throw new UnauthorizedException(
        payload?.error_description || payload?.msg || 'Login failed',
      );
    }
    const user = payload?.user;
    if (!payload?.access_token || !user?.id || !user?.email) {
      throw new UnauthorizedException('Login response missing token');
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || undefined,
      user: { id: String(user.id), email: String(user.email).toLowerCase() },
    };
  }

  async verifyJwt(token: string): Promise<VerifiedJwt> {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) {
      throw new UnauthorizedException('Missing token');
    }

    if (this.mockEnabled) {
      return this.verifyMockToken(normalizedToken);
    }

    this.ensureSupabaseRuntime();
    const response = await fetch(`${this.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: this.supabaseAnonKey,
        Authorization: `Bearer ${normalizedToken}`,
      },
    });
    const payload = await this.readJson(response);
    if (!response.ok) {
      throw new UnauthorizedException(
        payload?.error_description || payload?.msg || payload?.message || 'Invalid token',
      );
    }

    const sub = String(payload?.id || payload?.sub || '').trim();
    if (!sub) {
      throw new UnauthorizedException('Token subject missing');
    }
    const email = payload?.email ? String(payload.email).toLowerCase() : null;
    return { sub, email };
  }

  private verifyMockToken(token: string): VerifiedJwt {
    const parts = token.split('.');
    if (parts.length < 2) {
      throw new UnauthorizedException('Invalid mock token');
    }
    const payload = this.decodeJsonSegment(parts[1]);
    const exp = Number(payload?.exp || 0);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expired');
    }
    const sub = String(payload?.sub || '').trim();
    if (!sub) {
      throw new UnauthorizedException('Token subject missing');
    }
    return { sub, email: payload?.email ? String(payload.email) : null };
  }

  private createMockAccessToken(user: AuthUser) {
    const header = { alg: 'none', typ: 'JWT' };
    const payload = {
      sub: user.id,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      jti: randomUUID(),
    };
    return `${this.encodeJsonSegment(header)}.${this.encodeJsonSegment(payload)}.mock`;
  }

  private ensureSupabaseRuntime() {
    if (!this.supabaseUrl || !this.supabaseAnonKey) {
      throw new BadRequestException(
        'SUPABASE_URL and SUPABASE_ANON_KEY are required',
      );
    }
  }

  private async readJson(response: Response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  private decodeJsonSegment(value: string) {
    try {
      const decoded = this.decodeBase64Url(value).toString('utf8');
      return JSON.parse(decoded);
    } catch {
      throw new UnauthorizedException('Invalid token payload');
    }
  }

  private encodeJsonSegment(value: unknown) {
    return Buffer.from(JSON.stringify(value), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private decodeBase64Url(value: string) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    return Buffer.from(padded, 'base64');
  }
}
