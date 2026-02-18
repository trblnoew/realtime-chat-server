import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageEntity } from './entities/message.entity';
import { RoomEntity } from './entities/room.entity';
import {
  RoomMembershipEntity,
  RoomMembershipRole,
} from './entities/room-membership.entity';
import { RoomReadStateEntity } from './entities/room-read-state.entity';
import { UserEntity } from './entities/user.entity';

type InviteStatus = 'pending' | 'accepted' | 'rejected';

export type ChatMessage = {
  id: string;
  roomId: string;
  text: string;
  userId: string;
  sentAt: string;
  file?: {
    name: string;
    mimeType: string;
    size: number;
    dataUrl: string;
  };
};

export type RoomInvite = {
  id: string;
  roomId: string;
  fromUserId: string;
  toUserId: string;
  status: InviteStatus;
  createdAt: string;
};

export type RoomSummary = {
  roomId: string;
  type: 'channel' | 'dm';
};

export type DirectRoomSummary = {
  roomId: string;
  peerUserId: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unreadCount: number;
};

@Injectable()
export class ChatStoreService implements OnModuleInit {
  private readonly friends = new Map<string, Set<string>>();
  private readonly invites = new Map<string, RoomInvite>();

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(RoomEntity)
    private readonly roomRepo: Repository<RoomEntity>,
    @InjectRepository(RoomMembershipEntity)
    private readonly membershipRepo: Repository<RoomMembershipEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @InjectRepository(RoomReadStateEntity)
    private readonly roomReadStateRepo: Repository<RoomReadStateEntity>,
  ) {}

  async onModuleInit() {
    await this.seedDummyData();
  }

  async addFriend(userId: string, friendId: string) {
    await this.ensureUserExists(userId);
    await this.ensureUserExists(friendId);
    if (userId === friendId) {
      throw new BadRequestException('Cannot add yourself as a friend');
    }
    this.addFriendLink(userId, friendId);
    this.addFriendLink(friendId, userId);
  }

  getFriends(userId: string) {
    return Array.from(this.friends.get(userId) ?? []);
  }

  isDirectRoomId(roomId: string) {
    return roomId.startsWith('dm:');
  }

  toDirectRoomId(userA: string, userB: string) {
    const [left, right] = [userA.trim(), userB.trim()].sort((a, b) =>
      a.localeCompare(b),
    );
    return `dm:${left}:${right}`;
  }

  async inviteToRoom(roomId: string, fromUserId: string, toUserId: string) {
    await this.ensureUserExists(fromUserId);
    await this.ensureUserExists(toUserId);
    await this.ensureRoom(roomId);
    await this.ensureMembership(roomId, fromUserId);
    const invite: RoomInvite = {
      id: randomUUID(),
      roomId,
      fromUserId,
      toUserId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.invites.set(invite.id, invite);
    return invite;
  }

  async acceptInvite(inviteId: string, userId: string) {
    const invite = this.invites.get(inviteId);
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== 'pending') {
      throw new BadRequestException('Invite is not pending');
    }
    if (invite.toUserId !== userId) {
      throw new BadRequestException('Invite target mismatch');
    }
    invite.status = 'accepted';
    await this.addRoomMember(invite.roomId, userId);
    return invite;
  }

  async rejectInvite(inviteId: string, userId: string) {
    const invite = this.invites.get(inviteId);
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== 'pending') {
      throw new BadRequestException('Invite is not pending');
    }
    if (invite.toUserId !== userId) {
      throw new BadRequestException('Invite target mismatch');
    }
    invite.status = 'rejected';
    return invite;
  }

  getInvites(userId: string) {
    return Array.from(this.invites.values()).filter(
      (invite) => invite.toUserId === userId && invite.status === 'pending',
    );
  }

  async createRoom(roomId: string, ownerUserId?: string) {
    const normalizedRoomId = roomId.trim();
    if (!normalizedRoomId) {
      throw new BadRequestException('roomId is required');
    }
    const existing = await this.roomRepo.findOneBy({ id: normalizedRoomId });
    if (existing) {
      throw new BadRequestException('Room already exists');
    }
    const normalizedOwner = ownerUserId?.trim();
    if (!normalizedOwner) {
      throw new BadRequestException('ownerUserId is required');
    }
    await this.ensureUserExists(normalizedOwner);
    await this.roomRepo.save(
      this.roomRepo.create({
        id: normalizedRoomId,
        ownerUserId: normalizedOwner,
        isPrivate: true,
      }),
    );
    await this.addRoomMember(normalizedRoomId, normalizedOwner, 'owner');
    return {
      roomId: normalizedRoomId,
      members: [normalizedOwner],
    };
  }

  async getRoomIdsForUser(userId: string): Promise<RoomSummary[]> {
    await this.ensureUserExists(userId);
    const memberships = await this.membershipRepo.find({
      where: { userId },
      order: { joinedAt: 'ASC' },
    });
    return memberships.map((row) => ({
      roomId: row.roomId,
      type: this.isDirectRoomId(row.roomId) ? 'dm' : 'channel',
    }));
  }

  ensureFriends(userA: string, userB: string) {
    const friends = this.friends.get(userA) ?? new Set<string>();
    if (!friends.has(userB)) {
      throw new ForbiddenException('Users are not friends');
    }
  }

  async getOrCreateDirectRoom(userA: string, userB: string) {
    await this.ensureUserExists(userA);
    await this.ensureUserExists(userB);
    if (userA === userB) {
      throw new BadRequestException('Cannot create DM with yourself');
    }
    this.ensureFriends(userA, userB);

    const roomId = this.toDirectRoomId(userA, userB);
    const existing = await this.roomRepo.findOneBy({ id: roomId });
    if (!existing) {
      await this.roomRepo.save(
        this.roomRepo.create({
          id: roomId,
          ownerUserId: userA,
          isPrivate: true,
        }),
      );
    }

    await this.addRoomMember(roomId, userA, 'owner');
    await this.addRoomMember(roomId, userB, 'member');

    return {
      roomId,
      peerUserId: userA === userB ? userA : userB,
    };
  }

  async getRoomPeerUserId(roomId: string, currentUserId: string) {
    if (!this.isDirectRoomId(roomId)) {
      throw new BadRequestException('Not a direct room');
    }
    await this.ensureMembership(roomId, currentUserId);

    const parts = roomId.split(':');
    if (parts.length !== 3) {
      throw new BadRequestException('Invalid direct room id');
    }
    const left = parts[1];
    const right = parts[2];
    if (left !== currentUserId && right !== currentUserId) {
      throw new ForbiddenException('Not a direct room member');
    }
    return left === currentUserId ? right : left;
  }

  async getDirectRoomsForUser(userId: string): Promise<DirectRoomSummary[]> {
    await this.ensureUserExists(userId);
    const memberships = await this.membershipRepo.find({
      where: { userId },
      order: { joinedAt: 'DESC' },
    });
    const directMemberships = memberships.filter((row) =>
      this.isDirectRoomId(row.roomId),
    );

    const rooms = await Promise.all(
      directMemberships.map(async (membership) => {
        const peerUserId = await this.getRoomPeerUserId(membership.roomId, userId);
        const lastMessage = await this.messageRepo.findOne({
          where: { roomId: membership.roomId },
          order: { sentAt: 'DESC' },
        });
        return {
          roomId: membership.roomId,
          peerUserId,
          lastMessageAt: lastMessage?.sentAt?.toISOString(),
          lastMessagePreview: this.toPreviewText(lastMessage),
          unreadCount: await this.getUnreadCountForRoom(membership.roomId, userId),
        };
      }),
    );

    return rooms.sort((a, b) => {
      const aTime = a.lastMessageAt ?? '';
      const bTime = b.lastMessageAt ?? '';
      return bTime.localeCompare(aTime);
    });
  }

  async addRoomMember(
    roomId: string,
    userId: string,
    role: RoomMembershipRole = 'member',
  ) {
    await this.ensureUserExists(userId);
    await this.ensureRoom(roomId);
    const existing = await this.membershipRepo.findOneBy({ roomId, userId });
    if (!existing) {
      await this.membershipRepo.save(
        this.membershipRepo.create({ roomId, userId, role }),
      );
    }
  }

  async signupUser(userId: string) {
    const normalized = userId.trim();
    if (!normalized) {
      throw new BadRequestException('userId is required');
    }
    const existing = await this.userRepo.findOneBy({ id: normalized });
    if (existing) {
      throw new BadRequestException('userId already exists');
    }
    await this.userRepo.save(this.userRepo.create({ id: normalized }));
    return { userId: normalized };
  }

  async loginUser(userId: string) {
    const normalized = userId.trim();
    if (!normalized) {
      throw new BadRequestException('userId is required');
    }
    const existing = await this.userRepo.findOneBy({ id: normalized });
    if (!existing) {
      throw new NotFoundException('userId not found');
    }
    return { userId: normalized };
  }

  async getUsers() {
    const users = await this.userRepo.find({ order: { id: 'ASC' } });
    return users.map((user) => user.id);
  }

  async getRoomMembers(roomId: string, requesterUserId: string) {
    await this.ensureMembership(roomId, requesterUserId);
    const members = await this.membershipRepo.find({
      where: { roomId },
      order: { joinedAt: 'ASC' },
    });
    return members.map((member) => member.userId);
  }

  async saveMessage(message: ChatMessage) {
    await this.ensureMembership(message.roomId, message.userId);
    await this.messageRepo.save(
      this.messageRepo.create({
        id: message.id,
        roomId: message.roomId,
        userId: message.userId,
        text: message.text,
        fileName: message.file?.name ?? null,
        fileMimeType: message.file?.mimeType ?? null,
        fileSize: message.file?.size ?? null,
        fileDataUrl: message.file?.dataUrl ?? null,
        sentAt: new Date(message.sentAt),
      }),
    );
  }

  async getRoomMessages(roomId: string, userId: string, limit = 50) {
    await this.ensureMembership(roomId, userId);
    const rows = await this.messageRepo.find({
      where: { roomId },
      order: { sentAt: 'DESC' },
      take: limit,
    });
    return rows
      .reverse()
      .map((row) => this.toChatMessage(row));
  }

  async ensureMembership(roomId: string, userId: string) {
    const membership = await this.membershipRepo.findOneBy({ roomId, userId });
    if (!membership) {
      throw new ForbiddenException('Not a room member');
    }
  }

  async markRoomRead(roomId: string, userId: string) {
    await this.ensureMembership(roomId, userId);
    if (!this.isDirectRoomId(roomId)) {
      throw new BadRequestException('Not a direct room');
    }

    const lastMessage = await this.messageRepo.findOne({
      where: { roomId },
      order: { sentAt: 'DESC' },
    });

    const existing = await this.roomReadStateRepo.findOneBy({ roomId, userId });
    if (existing) {
      existing.lastReadMessageId = lastMessage?.id ?? null;
      existing.lastReadAt = lastMessage?.sentAt ?? new Date();
      await this.roomReadStateRepo.save(existing);
      return;
    }

    await this.roomReadStateRepo.save(
      this.roomReadStateRepo.create({
        roomId,
        userId,
        lastReadMessageId: lastMessage?.id ?? null,
        lastReadAt: lastMessage?.sentAt ?? new Date(),
      }),
    );
  }

  async getUnreadCountForRoom(roomId: string, userId: string) {
    await this.ensureMembership(roomId, userId);
    if (!this.isDirectRoomId(roomId)) {
      return 0;
    }

    const readState = await this.roomReadStateRepo.findOneBy({ roomId, userId });
    const query = this.messageRepo
      .createQueryBuilder('m')
      .where('m.room_id = :roomId', { roomId })
      .andWhere('m.user_id != :userId', { userId });

    if (readState?.lastReadAt) {
      query.andWhere('m.sent_at > :lastReadAt', {
        lastReadAt: readState.lastReadAt,
      });
    }

    return query.getCount();
  }

  async ensureUserExists(userId: string) {
    const existing = await this.userRepo.findOneBy({ id: userId });
    if (existing) {
      return;
    }
    throw new NotFoundException(`userId not found: ${userId}`);
  }

  private async ensureRoom(roomId: string) {
    const existing = await this.roomRepo.findOneBy({ id: roomId });
    if (existing) {
      return;
    }
    throw new NotFoundException(`room not found: ${roomId}`);
  }

  private addFriendLink(userId: string, friendId: string) {
    const set = this.friends.get(userId) ?? new Set<string>();
    set.add(friendId);
    this.friends.set(userId, set);
  }

  private toChatMessage(row: MessageEntity): ChatMessage {
    return {
      id: row.id,
      roomId: row.roomId,
      text: row.text,
      userId: row.userId,
      sentAt: row.sentAt.toISOString(),
      file:
        row.fileName && row.fileMimeType && row.fileDataUrl && row.fileSize
          ? {
              name: row.fileName,
              mimeType: row.fileMimeType,
              size: row.fileSize,
              dataUrl: row.fileDataUrl,
            }
          : undefined,
    };
  }

  private toPreviewText(message?: MessageEntity | null) {
    if (!message) {
      return '';
    }
    if (message.fileName || message.fileDataUrl) {
      return '[file]';
    }
    const clean = (message.text ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) {
      return '';
    }
    return clean.length > 10 ? `${clean.slice(0, 10)}...` : clean;
  }

  private async seedDummyData() {
    const hasUsers = (await this.userRepo.count()) > 0;
    if (hasUsers) {
      return;
    }

    await this.signupUser('alice');
    await this.signupUser('bob');
    await this.signupUser('charlie');

    this.addFriendLink('alice', 'bob');
    this.addFriendLink('bob', 'alice');
    this.addFriendLink('alice', 'charlie');
    this.addFriendLink('charlie', 'alice');

    await this.createRoom('lobby', 'alice');
    await this.addRoomMember('lobby', 'bob');
    await this.addRoomMember('lobby', 'charlie');
    await this.createRoom('project-alpha', 'alice');
    await this.addRoomMember('project-alpha', 'bob');

    await this.saveMessage({
      id: randomUUID(),
      roomId: 'lobby',
      userId: 'alice',
      text: 'Welcome to lobby',
      sentAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    });
    await this.saveMessage({
      id: randomUUID(),
      roomId: 'lobby',
      userId: 'bob',
      text: 'Hi all',
      sentAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    });
    await this.saveMessage({
      id: randomUUID(),
      roomId: 'project-alpha',
      userId: 'alice',
      text: 'Kickoff at 2pm',
      sentAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
    });

    await this.inviteToRoom('project-alpha', 'alice', 'charlie');

    await this.getOrCreateDirectRoom('alice', 'bob');
  }
}
