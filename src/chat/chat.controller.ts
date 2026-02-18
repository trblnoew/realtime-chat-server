import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChatStoreService } from './chat-store.service';
import { RealtimeNotifyService } from './realtime-notify.service';

@Controller('social')
export class ChatController {
  constructor(
    private readonly chatStore: ChatStoreService,
    private readonly realtimeNotify: RealtimeNotifyService,
  ) {}

  @Post('friends')
  async addFriend(
    @Body() body: { userId: string; friendId: string },
    @Req() request: Request,
  ) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    await this.chatStore.addFriend(actorUserId, body.friendId.trim());
    return { ok: true };
  }

  @Get('friends/:userId')
  getFriends(@Param('userId') userId: string, @Req() request: Request) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    if (actorUserId !== userId) {
      throw new ForbiddenException('Forbidden');
    }
    return {
      userId,
      friends: this.chatStore.getFriends(userId),
    };
  }

  @Post('rooms/invite')
  async inviteToRoom(
    @Body() body: { roomId?: string; fromUserId: string; toUserId: string },
    @Req() request: Request,
  ) {
    const fromUserId = this.getCurrentUserIdOrThrow(request);
    const toUserId = body.toUserId.trim();
    const roomId = (body.roomId ?? 'lobby').trim();
    const invite = await this.chatStore.inviteToRoom(roomId, fromUserId, toUserId);
    this.realtimeNotify.notifyInvite(toUserId, {
      type: 'room_invite',
      inviteId: invite.id,
      roomId,
      fromUserId,
      createdAt: invite.createdAt,
    });
    return { ok: true, invite };
  }

  @Post('rooms')
  async createRoom(
    @Body() body: { roomId: string; ownerUserId?: string },
    @Req() request: Request,
  ) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    const room = await this.chatStore.createRoom(body.roomId, actorUserId);
    return { ok: true, room };
  }

  @Get('rooms')
  async getRooms(@Req() request: Request) {
    const currentUserId = this.getCurrentUserIdOrThrow(request);
    return {
      rooms: await this.chatStore.getRoomIdsForUser(currentUserId),
    };
  }

  @Post('rooms/invite/accept')
  async acceptInvite(
    @Body() body: { inviteId: string; userId: string },
    @Req() request: Request,
  ) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    if (body.userId?.trim() && body.userId.trim() !== actorUserId) {
      throw new ForbiddenException('Forbidden');
    }
    const invite = await this.chatStore.acceptInvite(body.inviteId, actorUserId);
    return { ok: true, invite };
  }

  @Post('rooms/invite/reject')
  async rejectInvite(
    @Body() body: { inviteId: string; userId?: string },
    @Req() request: Request,
  ) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    if (body.userId?.trim() && body.userId.trim() !== actorUserId) {
      throw new ForbiddenException('Forbidden');
    }
    const invite = await this.chatStore.rejectInvite(body.inviteId, actorUserId);
    return { ok: true, invite };
  }

  @Get('invites/:userId')
  getInvites(@Param('userId') userId: string, @Req() request: Request) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    if (actorUserId !== userId) {
      throw new ForbiddenException('Forbidden');
    }
    return {
      userId,
      invites: this.chatStore.getInvites(userId),
    };
  }

  @Get('rooms/:roomId/members')
  async getRoomMembers(@Param('roomId') roomId: string, @Req() request: Request) {
    const currentUserId = this.getCurrentUserIdOrThrow(request);
    return {
      roomId,
      members: await this.chatStore.getRoomMembers(roomId, currentUserId),
    };
  }

  @Get('rooms/:roomId/messages')
  async getRoomMessages(
    @Param('roomId') roomId: string,
    @Req() request: Request,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const currentUserId = this.getCurrentUserIdOrThrow(request);
    return {
      roomId,
      messages: await this.chatStore.getRoomMessages(
        roomId,
        currentUserId,
        limit ?? 50,
      ),
    };
  }

  @Post('dm/start')
  async startDirectMessage(
    @Body() body: { toUserId: string },
    @Req() request: Request,
  ) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    const toUserId = body.toUserId.trim();
    const room = await this.chatStore.getOrCreateDirectRoom(actorUserId, toUserId);
    return { ok: true, room };
  }

  @Get('dm/rooms')
  async getDirectRooms(@Req() request: Request) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    return {
      rooms: await this.chatStore.getDirectRoomsForUser(actorUserId),
    };
  }

  @Post('dm/rooms/:roomId/read')
  async markDirectRoomRead(@Param('roomId') roomId: string, @Req() request: Request) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    await this.chatStore.markRoomRead(roomId, actorUserId);
    return { ok: true };
  }

  private getCurrentUserIdOrThrow(request: Request) {
    const cookieHeader = request.headers.cookie ?? '';
    const authCookie = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('rt_auth_user='));
    if (!authCookie) {
      throw new UnauthorizedException('Login required');
    }
    const value = authCookie.slice('rt_auth_user='.length).trim();
    if (!value) {
      throw new UnauthorizedException('Login required');
    }
    return decodeURIComponent(value);
  }
}
