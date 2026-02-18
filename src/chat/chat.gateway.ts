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

  private readonly onlineUsers = new Map<string, string>();

  constructor(
    private readonly chatService: ChatService,
    private readonly chatStore: ChatStoreService,
    private readonly realtimeNotify: RealtimeNotifyService,
  ) {}

  afterInit() {
    this.realtimeNotify.attachServer(this.server);
  }

  handleConnection(client: Socket) {
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
  async handleMessage(
    @MessageBody() data: MessageDto,
    @ConnectedSocket() client: Socket,
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
      await this.chatStore.saveMessage(payload);
      this.server.to(payload.roomId).emit('message', payload);
      return { event: 'sent' };
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

  private emitOnlineUsers() {
    const users = Array.from(new Set(this.onlineUsers.values())).map((userId) => ({
      userId,
    }));
    this.server.emit('online_users', users);
  }
}
