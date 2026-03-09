import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';

export type AuthenticatedUser = {
  id: string;
  email?: string | null;
};

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly supabaseAuth: SupabaseAuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = String(request.headers.authorization || '').trim();
    const token = this.extractBearerToken(authHeader);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const verified = await this.supabaseAuth.verifyJwt(token);
    request.user = { id: verified.sub, email: verified.email ?? null };
    return true;
  }

  private extractBearerToken(authHeader: string) {
    if (!authHeader) return '';
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice('bearer '.length).trim();
    }
    return '';
  }
}
