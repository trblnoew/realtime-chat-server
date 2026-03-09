import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ChatStoreService } from './chat-store.service';
import { SupabaseAuthService } from '../auth/supabase-auth.service';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly chatStore: ChatStoreService,
    private readonly supabaseAuth: SupabaseAuthService,
  ) {}

  @Post('signup')
  async signup(
    @Body() body: { email: string; password: string; nickname: string },
  ) {
    await this.chatStore.assertSignupProfileAvailable(body.email, body.nickname);
    const authUser = await this.supabaseAuth.signUp(body.email, body.password);
    const user = await this.chatStore.upsertUserFromAuth({
      id: authUser.id,
      email: authUser.email,
      nickname: body.nickname,
    });
    return { ok: true, user };
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const loginResult = await this.supabaseAuth.signIn(body.email, body.password);
    const user = await this.chatStore.getUserById(loginResult.user.id);
    return {
      ok: true,
      accessToken: loginResult.accessToken,
      refreshToken: loginResult.refreshToken,
      user,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() request: Request) {
    const authenticated = request as AuthenticatedRequest;
    const actorUserId = String(authenticated.user?.id || '').trim();
    const user = await this.chatStore.getUserById(actorUserId);
    return { user };
  }

  @UseGuards(JwtAuthGuard)
  @Get('users')
  async getUsers() {
    const users = await this.chatStore.getUsers();
    return {
      users: users.map((user) => ({
        id: user.id,
        nickname: user.nickname,
      })),
    };
  }
}
