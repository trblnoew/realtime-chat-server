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
    this.notifyUser(toUserId, 'invite_alarm', payload);
  }

  notifyUser(userId: string, event: string, payload: unknown) {
    if (!this.server) return;
    const sockets = this.socketsByUser.get(userId);
    if (!sockets || sockets.size === 0) return;
    for (const socketId of sockets) {
      this.server.to(socketId).emit(event, payload);
    }
  }

  notifyUsers(userIds: string[], event: string, payload: unknown) {
    const deduped = Array.from(new Set((userIds || []).map((id) => String(id || '').trim())));
    deduped.forEach((userId) => {
      if (!userId) return;
      this.notifyUser(userId, event, payload);
    });
  }

  getSocketCount(userId: string) {
    const sockets = this.socketsByUser.get(String(userId || '').trim());
    if (!sockets) return 0;
    return sockets.size;
  }

  getOnlineUserIds() {
    return Array.from(this.socketsByUser.keys());
  }

  reset() {
    this.socketsByUser.clear();
    this.server = undefined;
  }

  hasAttachedServer() {
    return Boolean(this.server);
  }

  hasUser(userId: string) {
    return this.socketsByUser.has(String(userId || '').trim());
  }

  hasSocket(userId: string, socketId: string) {
    const sockets = this.socketsByUser.get(String(userId || '').trim());
    if (!sockets) return false;
    return sockets.has(String(socketId || '').trim());
  }

  getSockets(userId: string) {
    return Array.from(this.socketsByUser.get(String(userId || '').trim()) ?? []);
  }

  totalSocketCount() {
    let total = 0;
    for (const sockets of this.socketsByUser.values()) {
      total += sockets.size;
    }
    return total;
  }
}
