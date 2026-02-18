import { Body, Controller, Get, Post } from '@nestjs/common';
import { ChatStoreService } from './chat-store.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly chatStore: ChatStoreService) {}

  @Post('signup')
  async signup(@Body() body: { userId: string }) {
    const result = await this.chatStore.signupUser(body.userId);
    return { ok: true, ...result };
  }

  @Post('login')
  async login(@Body() body: { userId: string }) {
    const result = await this.chatStore.loginUser(body.userId);
    return { ok: true, ...result };
  }

  @Get('users')
  async getUsers() {
    return { users: await this.chatStore.getUsers() };
  }
}
