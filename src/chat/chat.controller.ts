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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChatStoreService } from './chat-store.service';
import { RealtimeNotifyService } from './realtime-notify.service';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/jwt-auth.guard';

@Controller('social')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatStore: ChatStoreService,
    private readonly realtimeNotify: RealtimeNotifyService,
  ) {}

  @Post('friends')
  async addFriend(
    @Body() body: { friendNickname: string },
    @Req() request: Request,
  ) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    const friendUserId = await this.chatStore.getUserIdByNicknameOrThrow(
      body.friendNickname,
    );
    const created = await this.chatStore.addFriend(actorUserId, friendUserId);
    this.realtimeNotify.notifyUser(friendUserId, 'friend_request_new', {
      request: created,
    });
    return { ok: true, mode: 'request_created', request: created };
  }

  @Post('friend-requests')
  async createFriendRequest(
    @Body() body: { toNickname: string },
    @Req() request: Request,
  ) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    const toUserId = await this.chatStore.getUserIdByNicknameOrThrow(body.toNickname);
    const created = await this.chatStore.createFriendRequest(actorUserId, toUserId);
    this.realtimeNotify.notifyUser(toUserId, 'friend_request_new', {
      request: created,
    });
    return { ok: true, request: created };
  }

  @Get('friend-requests/incoming')
  async getIncomingFriendRequests(@Req() request: Request) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    return {
      requests: await this.chatStore.getIncomingFriendRequests(actorUserId),
    };
  }

  @Get('friend-requests/outgoing')
  async getOutgoingFriendRequests(@Req() request: Request) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    return {
      requests: await this.chatStore.getOutgoingFriendRequests(actorUserId),
    };
  }

  @Post('friend-requests/:requestId/accept')
  async acceptFriendRequest(
    @Param('requestId') requestId: string,
    @Req() request: Request,
  ) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    const accepted = await this.chatStore.acceptFriendRequest(requestId, actorUserId);
    this.realtimeNotify.notifyUsers(
      [accepted.fromUserId, accepted.toUserId],
      'friend_request_updated',
      { request: accepted },
    );
    return { ok: true, request: accepted };
  }

  @Post('friend-requests/:requestId/reject')
  async rejectFriendRequest(
    @Param('requestId') requestId: string,
    @Req() request: Request,
  ) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    const rejected = await this.chatStore.rejectFriendRequest(requestId, actorUserId);
    this.realtimeNotify.notifyUsers(
      [rejected.fromUserId, rejected.toUserId],
      'friend_request_updated',
      { request: rejected },
    );
    return { ok: true, request: rejected };
  }

  @Get('friends/:userId')
  async getFriends(@Param('userId') userId: string, @Req() request: Request) {
    const actorUserId = this.getCurrentUserIdOrThrow(request);
    if (actorUserId !== userId) {
      throw new ForbiddenException('Forbidden');
    }
    return {
      userId,
      friends: await this.chatStore.getFriends(userId),
    };
  }

  @Post('rooms/invite')
  async inviteToRoom(
    @Body() body: { roomId?: string; toNickname: string },
    @Req() request: Request,
  ) {
    const fromUserId = this.getCurrentUserIdOrThrow(request);
    const toUserId = await this.chatStore.getUserIdByNicknameOrThrow(
      body.toNickname,
    );
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
    @Query('afterSeq') afterSeqRaw?: string,
  ) {
    const currentUserId = this.getCurrentUserIdOrThrow(request);
    const afterSeq = Number(afterSeqRaw);
    if (Number.isFinite(afterSeq) && afterSeq >= 0) {
      return {
        roomId,
        messages: await this.chatStore.getRoomMessagesAfterSeq(
          roomId,
          currentUserId,
          Math.floor(afterSeq),
          limit ?? 50,
        ),
      };
    }
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
    const authenticated = request as AuthenticatedRequest;
    const value = String(authenticated.user?.id || '').trim();
    if (!value) {
      throw new ForbiddenException('Forbidden');
    }
    return value;
  }
}
