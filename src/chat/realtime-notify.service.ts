import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class RealtimeNotifyService {
  private server?: Server;
  private readonly socketsByUser = new Map<string, Set<string>>();

  attachServer(server: Server) {
    this.server = server;
  }

  registerSocket(userId: string, socketId: string) {
    const set = this.socketsByUser.get(userId) ?? new Set<string>();
    set.add(socketId);
    this.socketsByUser.set(userId, set);
  }

  moveSocket(previousUserId: string, nextUserId: string, socketId: string) {
    this.unregisterSocket(previousUserId, socketId);
    this.registerSocket(nextUserId, socketId);
  }

  unregisterSocket(userId: string, socketId: string) {
    const set = this.socketsByUser.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) {
      this.socketsByUser.delete(userId);
    }
  }

  notifyInvite(toUserId: string, payload: unknown) {
    if (!this.server) return;
    const sockets = this.socketsByUser.get(toUserId);
    if (!sockets || sockets.size === 0) return;
    for (const socketId of sockets) {
      this.server.to(socketId).emit('invite_alarm', payload);
    }
  }
}
