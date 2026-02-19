import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { MessageDto } from './dto/message.dto';
import { ChatStoreService } from './chat-store.service';
import { RealtimeNotifyService } from './realtime-notify.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly onlineUsers = new Map<string, string>();

  constructor(
    private readonly chatService: ChatService,
    private readonly chatStore: ChatStoreService,
    private readonly realtimeNotify: RealtimeNotifyService,
  ) {}

  afterInit() {
    this.realtimeNotify.attachServer(this.server);
  }

  handleConnection(_client: Socket) {
    this.emitOnlineUsers();
  }

  handleDisconnect(client: Socket) {
    const userId = this.onlineUsers.get(client.id);
    if (userId) {
      this.realtimeNotify.unregisterSocket(userId, client.id);
    }
    this.onlineUsers.delete(client.id);
    this.emitOnlineUsers();
  }

  @SubscribeMessage('message')
  async handleLegacyMessage(
    @MessageBody() data: MessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const normalized: MessageDto = {
      ...data,
      clientMsgId: randomUUID(),
      sentAtClient: new Date().toISOString(),
    };
    return this.processMessageSend(normalized, client);
  }

  @SubscribeMessage('message_send')
  async handleMessageSend(
    @MessageBody() data: MessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    return this.processMessageSend(data, client);
  }

  @SubscribeMessage('message_resync')
  async handleMessageResync(
    @MessageBody() data: { roomId?: string; afterSeq?: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const effectiveUserId = this.onlineUsers.get(client.id);
      if (!effectiveUserId) {
        throw new WsException('Login required');
      }
      const roomId = (data.roomId ?? 'lobby').trim() || 'lobby';
      const afterSeq = Number(data.afterSeq ?? 0);
      await this.chatStore.ensureMembership(roomId, effectiveUserId);
      client.join(roomId);
      const messages = await this.chatStore.getRoomMessagesAfterSeq(
        roomId,
        effectiveUserId,
        Number.isFinite(afterSeq) && afterSeq > 0 ? Math.floor(afterSeq) : 0,
        100,
      );
      this.logCounter('message.resend.request.count', roomId);
      client.emit('message_resync_result', { roomId, messages });
      return { event: 'resync_ok', roomId, count: messages.length };
    } catch (error) {
      throw new WsException((error as Error).message);
    }
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @MessageBody() data: { roomId?: string; userId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const roomId = (data.roomId ?? 'lobby').trim() || 'lobby';
      const effectiveUserId = this.onlineUsers.get(client.id);
      if (!effectiveUserId) {
        throw new WsException('Login required');
      }
      await this.chatStore.ensureMembership(roomId, effectiveUserId);
      client.join(roomId);
      return { event: 'room_joined', roomId };
    } catch (error) {
      throw new WsException((error as Error).message);
    }
  }

  @SubscribeMessage('set_user')
  async handleSetUser(
    @MessageBody() data: { userId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const previousUserId = this.onlineUsers.get(client.id);
    const nextUserId = (data.userId ?? '').trim();

    if (!nextUserId) {
      if (previousUserId) {
        this.realtimeNotify.unregisterSocket(previousUserId, client.id);
        this.onlineUsers.delete(client.id);
      }
      this.emitOnlineUsers();
      return { event: 'user_cleared' };
    }

    try {
      await this.chatStore.loginUser(nextUserId);
    } catch (error) {
      throw new WsException((error as Error).message);
    }
    if (previousUserId && previousUserId !== nextUserId) {
      this.realtimeNotify.moveSocket(previousUserId, nextUserId, client.id);
    }
    if (!previousUserId) {
      this.realtimeNotify.registerSocket(nextUserId, client.id);
    }
    this.onlineUsers.set(client.id, nextUserId);
    this.emitOnlineUsers();
    return { event: 'user_updated' };
  }

  private async processMessageSend(
    data: MessageDto,
    client: Socket,
  ) {
    try {
      const effectiveUserId = this.onlineUsers.get(client.id);
      if (!effectiveUserId) {
        throw new WsException('Login required');
      }
      const roomId = (data.roomId ?? 'lobby').trim() || 'lobby';
      await this.chatStore.ensureMembership(roomId, effectiveUserId);

      const payload = this.chatService.buildMessage(client, {
        ...data,
        userId: effectiveUserId,
        roomId,
      });

      client.join(payload.roomId);
      const saved = await this.chatStore.saveMessageIdempotent(payload);

      const ack = {
        clientMsgId: payload.clientMsgId,
        serverMsgId: saved.message.id,
        roomId: payload.roomId,
        seq: saved.message.seq,
        status: saved.status,
      };
      client.emit('message_ack', ack);

      if (saved.status === 'accepted') {
        this.server.to(payload.roomId).emit('message_new', saved.message);
        this.server.to(payload.roomId).emit('message', saved.message);
        this.logCounter('message.accepted.count', payload.roomId);
      } else {
        this.logCounter('message.duplicate.count', payload.roomId);
      }

      return { event: 'sent', status: saved.status };
    } catch (error) {
      this.logCounter('message.rejected.count', data.roomId ?? 'lobby');
      throw new WsException((error as Error).message);
    }
  }

  private emitOnlineUsers() {
    const users = Array.from(new Set(this.onlineUsers.values())).map((userId) => ({
      userId,
    }));
    this.server.emit('online_users', users);
  }

  private logCounter(metric: string, roomId: string) {
    this.logger.log(JSON.stringify({ metric, roomId, at: new Date().toISOString() }));
  }
}
