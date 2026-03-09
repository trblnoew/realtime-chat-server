import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
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
import {
  FriendRequestEntity,
  FriendRequestStatus,
} from './entities/friend-request.entity';
import { FriendEdgeEntity } from './entities/friend-edge.entity';

type InviteStatus = 'pending' | 'accepted' | 'rejected';
type SaveStatus = 'accepted' | 'duplicate';

export type FriendRequestDto = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: FriendRequestStatus;
  createdAt: string;
  respondedAt: string | null;
};

export type ChatMessage = {
  id: string;
  clientMsgId: string;
  seq: number;
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

export type SaveMessageResult = {
  status: SaveStatus;
  message: ChatMessage;
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

export type AppUser = {
  id: string;
  email: string;
  nickname: string;
};

@Injectable()
export class ChatStoreService implements OnModuleInit {
  private readonly logger = new Logger(ChatStoreService.name);
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
    @InjectRepository(FriendRequestEntity)
    private readonly friendRequestRepo: Repository<FriendRequestEntity>,
    @InjectRepository(FriendEdgeEntity)
    private readonly friendEdgeRepo: Repository<FriendEdgeEntity>,
  ) {}

  async onModuleInit() {
    await this.seedDummyData();
  }

  async addFriend(userId: string, friendId: string) {
    this.logger.warn(
      'addFriend() is deprecated. Use createFriendRequest() for request workflow.',
    );
    return this.createFriendRequest(userId, friendId);
  }

  async createFriendRequest(fromUserId: string, toUserId: string) {
    const from = String(fromUserId || '').trim();
    const to = String(toUserId || '').trim();
    await this.ensureUserExists(from);
    await this.ensureUserExists(to);
    if (!from || !to) {
      throw new BadRequestException('fromUserId and toUserId are required');
    }
    if (from === to) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }
    if (await this.isFriend(from, to)) {
      throw new BadRequestException('Users are already friends');
    }

    return this.friendRequestRepo.manager.transaction(async (manager) => {
      const requestRepo = manager.getRepository(FriendRequestEntity);
      const existingPending = await requestRepo.findOne({
        where: [
          { fromUserId: from, toUserId: to, status: 'pending' },
          { fromUserId: to, toUserId: from, status: 'pending' },
        ],
      });
      if (existingPending) {
        throw new BadRequestException('Pending friend request already exists');
      }

      const created = await requestRepo.save(
        requestRepo.create({
          id: randomUUID(),
          fromUserId: from,
          toUserId: to,
          status: 'pending',
          respondedAt: null,
        }),
      );
      return this.toFriendRequestDto(created);
    });
  }

  async acceptFriendRequest(requestId: string, actorUserId: string) {
    const requestIdValue = String(requestId || '').trim();
    const actor = String(actorUserId || '').trim();
    if (!requestIdValue || !actor) {
      throw new BadRequestException('requestId and actorUserId are required');
    }

    return this.friendRequestRepo.manager.transaction(async (manager) => {
      const requestRepo = manager.getRepository(FriendRequestEntity);
      const edgeRepo = manager.getRepository(FriendEdgeEntity);
      const request = await requestRepo.findOneBy({ id: requestIdValue });
      if (!request) {
        throw new NotFoundException('Friend request not found');
      }
      if (request.toUserId !== actor) {
        throw new ForbiddenException('Only the target user can accept request');
      }
      if (request.status !== 'pending') {
        throw new BadRequestException('Friend request is not pending');
      }

      request.status = 'accepted';
      request.respondedAt = new Date();
      const updated = await requestRepo.save(request);

      await edgeRepo
        .createQueryBuilder()
        .insert()
        .into(FriendEdgeEntity)
        .values([
          { userId: request.fromUserId, friendUserId: request.toUserId },
          { userId: request.toUserId, friendUserId: request.fromUserId },
        ])
        .orIgnore()
        .execute();

      return this.toFriendRequestDto(updated);
    });
  }

  async rejectFriendRequest(requestId: string, actorUserId: string) {
    const requestIdValue = String(requestId || '').trim();
    const actor = String(actorUserId || '').trim();
    if (!requestIdValue || !actor) {
      throw new BadRequestException('requestId and actorUserId are required');
    }
    const request = await this.friendRequestRepo.findOneBy({ id: requestIdValue });
    if (!request) {
      throw new NotFoundException('Friend request not found');
    }
    if (request.toUserId !== actor) {
      throw new ForbiddenException('Only the target user can reject request');
    }
    if (request.status !== 'pending') {
      throw new BadRequestException('Friend request is not pending');
    }
    request.status = 'rejected';
    request.respondedAt = new Date();
    const updated = await this.friendRequestRepo.save(request);
    return this.toFriendRequestDto(updated);
  }

  async getIncomingFriendRequests(userId: string) {
    const normalized = String(userId || '').trim();
    await this.ensureUserExists(normalized);
    const rows = await this.friendRequestRepo.find({
      where: { toUserId: normalized, status: 'pending' },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.toFriendRequestDto(row));
  }

  async getOutgoingFriendRequests(userId: string) {
    const normalized = String(userId || '').trim();
    await this.ensureUserExists(normalized);
    const rows = await this.friendRequestRepo.find({
      where: { fromUserId: normalized, status: 'pending' },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.toFriendRequestDto(row));
  }

  async getFriends(userId: string) {
    const normalized = String(userId || '').trim();
    await this.ensureUserExists(normalized);
    const rows = await this.friendEdgeRepo.find({
      where: { userId: normalized },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => row.friendUserId);
  }

  async isFriend(userA: string, userB: string) {
    const row = await this.friendEdgeRepo.findOneBy({
      userId: userA,
      friendUserId: userB,
    });
    return Boolean(row);
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

  async ensureFriends(userA: string, userB: string) {
    const allowed = await this.isFriend(userA, userB);
    if (!allowed) {
      throw new ForbiddenException('Users are not friends');
    }
  }

  async getOrCreateDirectRoom(userA: string, userB: string) {
    await this.ensureUserExists(userA);
    await this.ensureUserExists(userB);
    if (userA === userB) {
      throw new BadRequestException('Cannot create DM with yourself');
    }
    await this.ensureFriends(userA, userB);

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
      peerUserId: userB,
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
          order: { seq: 'DESC', sentAt: 'DESC' },
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

  async assertSignupProfileAvailable(email: string, nickname: string) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedNickname = String(nickname || '').trim();
    if (!normalizedEmail || !normalizedNickname) {
      throw new BadRequestException('email and nickname are required');
    }
    await this.assertProfileAvailable(normalizedEmail, normalizedNickname);
  }

  async upsertUserFromAuth(user: { id: string; email: string; nickname: string }) {
    const id = String(user.id || '').trim();
    const email = String(user.email || '').trim().toLowerCase();
    const nickname = String(user.nickname || '').trim();
    if (!id || !email || !nickname) {
      throw new BadRequestException('id, email, nickname are required');
    }

    await this.assertProfileAvailable(email, nickname, id);

    const existing = await this.userRepo.findOneBy({ id });
    if (existing) {
      existing.email = email;
      existing.nickname = nickname;
      const saved = await this.userRepo.save(existing);
      return this.toAppUser(saved);
    }

    const created = await this.userRepo.save(
      this.userRepo.create({
        id,
        email,
        nickname,
      }),
    );
    return this.toAppUser(created);
  }

  async getUserById(id: string) {
    const existing = await this.userRepo.findOneBy({ id: String(id || '').trim() });
    if (!existing) {
      throw new NotFoundException('user not found');
    }
    return this.toAppUser(existing);
  }

  async getUserByEmail(email: string) {
    const normalized = String(email || '').trim().toLowerCase();
    const existing = await this.userRepo.findOneBy({ email: normalized });
    if (!existing) {
      throw new NotFoundException('user not found');
    }
    return this.toAppUser(existing);
  }

  async getUserIdByNicknameOrThrow(nickname: string) {
    const normalized = String(nickname || '').trim();
    if (!normalized) {
      throw new BadRequestException('nickname is required');
    }
    const existing = await this.userRepo.findOneBy({ nickname: normalized });
    if (!existing) {
      throw new NotFoundException('nickname not found');
    }
    return existing.id;
  }

  async getUsers() {
    const users = await this.userRepo.find({ order: { nickname: 'ASC' } });
    return users.map((user) => this.toAppUser(user));
  }

  async getRoomMembers(roomId: string, requesterUserId: string) {
    await this.ensureMembership(roomId, requesterUserId);
    const members = await this.membershipRepo.find({
      where: { roomId },
      order: { joinedAt: 'ASC' },
    });
    return members.map((member) => member.userId);
  }

  async saveMessageIdempotent(message: Omit<ChatMessage, 'seq'>) {
    await this.ensureMembership(message.roomId, message.userId);
    const normalizedClientMsgId = String(message.clientMsgId || '').trim();
    if (!normalizedClientMsgId) {
      throw new BadRequestException('clientMsgId is required');
    }

    return this.messageRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(MessageEntity);
      const existing = await repo.findOneBy({
        roomId: message.roomId,
        userId: message.userId,
        clientMsgId: normalizedClientMsgId,
      });
      if (existing) {
        return {
          status: 'duplicate' as const,
          message: this.toChatMessage(existing),
        };
      }

      const maxSeqRow = await repo
        .createQueryBuilder('m')
        .select('MAX(m.seq)', 'maxSeq')
        .where('m.room_id = :roomId', { roomId: message.roomId })
        .getRawOne<{ maxSeq: string | number | null }>();
      const nextSeq = this.parseSeq(maxSeqRow?.maxSeq) + 1;

      const saved = await repo.save(
        repo.create({
          id: message.id,
          roomId: message.roomId,
          userId: message.userId,
          clientMsgId: normalizedClientMsgId,
          seq: nextSeq,
          text: message.text,
          fileName: message.file?.name ?? null,
          fileMimeType: message.file?.mimeType ?? null,
          fileSize: message.file?.size ?? null,
          fileDataUrl: message.file?.dataUrl ?? null,
          sentAt: new Date(message.sentAt),
        }),
      );

      return {
        status: 'accepted' as const,
        message: this.toChatMessage(saved),
      };
    });
  }

  async getRoomMessages(roomId: string, userId: string, limit = 50) {
    await this.ensureMembership(roomId, userId);
    const rows = await this.messageRepo.find({
      where: { roomId },
      order: { seq: 'DESC', sentAt: 'DESC' },
      take: limit,
    });
    return rows.reverse().map((row) => this.toChatMessage(row));
  }

  async getRoomMessagesAfterSeq(
    roomId: string,
    userId: string,
    afterSeq: number,
    limit = 50,
  ) {
    await this.ensureMembership(roomId, userId);
    const rows = await this.messageRepo
      .createQueryBuilder('m')
      .where('m.room_id = :roomId', { roomId })
      .andWhere('m.seq IS NOT NULL')
      .andWhere('m.seq > :afterSeq', { afterSeq })
      .orderBy('m.seq', 'ASC')
      .addOrderBy('m.sent_at', 'ASC')
      .limit(limit)
      .getMany();
    return rows.map((row) => this.toChatMessage(row));
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
      order: { seq: 'DESC', sentAt: 'DESC' },
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

  private toChatMessage(row: MessageEntity): ChatMessage {
    return {
      id: row.id,
      clientMsgId: row.clientMsgId ?? row.id,
      seq: this.parseSeq(row.seq),
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

  private toAppUser(user: UserEntity): AppUser {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
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

  private parseSeq(value: string | number | null | undefined) {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return Math.floor(parsed);
  }

  private toFriendRequestDto(row: FriendRequestEntity): FriendRequestDto {
    return {
      id: row.id,
      fromUserId: row.fromUserId,
      toUserId: row.toUserId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    };
  }

  private async seedDummyData() {
    // Supabase 기반 인증 전환 이후에는 로컬 더미 사용자 시드를 생성하지 않는다.
  }

  private async assertProfileAvailable(
    email: string,
    nickname: string,
    allowedUserId?: string,
  ) {
    const byEmail = await this.userRepo.findOneBy({ email });
    if (byEmail && byEmail.id !== allowedUserId) {
      throw new BadRequestException('email already used');
    }
    const byNickname = await this.userRepo.findOneBy({ nickname });
    if (byNickname && byNickname.id !== allowedUserId) {
      throw new BadRequestException('nickname already used');
    }
  }
}
