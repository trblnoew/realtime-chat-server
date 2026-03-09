import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { ChatStoreService } from './chat-store.service';
import { MessageEntity } from './entities/message.entity';
import { RoomEntity } from './entities/room.entity';
import { RoomMembershipEntity } from './entities/room-membership.entity';
import { RoomReadStateEntity } from './entities/room-read-state.entity';
import { UserEntity } from './entities/user.entity';
import { FriendRequestEntity } from './entities/friend-request.entity';
import { FriendEdgeEntity } from './entities/friend-edge.entity';

describe('ChatStoreService', () => {
  let dataSource: DataSource;
  let service: ChatStoreService;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      synchronize: true,
      entities: [
        UserEntity,
        RoomEntity,
        RoomMembershipEntity,
        MessageEntity,
        RoomReadStateEntity,
        FriendRequestEntity,
        FriendEdgeEntity,
      ],
    });
    await dataSource.initialize();

    service = new ChatStoreService(
      dataSource.getRepository(UserEntity),
      dataSource.getRepository(RoomEntity),
      dataSource.getRepository(RoomMembershipEntity),
      dataSource.getRepository(MessageEntity),
      dataSource.getRepository(RoomReadStateEntity),
      dataSource.getRepository(FriendRequestEntity),
      dataSource.getRepository(FriendEdgeEntity),
    );

    await dataSource.getRepository(UserEntity).save([
      { id: 'alice', email: 'alice@test.com', nickname: 'alice' },
      { id: 'bob', email: 'bob@test.com', nickname: 'bob' },
    ]);
    await dataSource
      .getRepository(RoomEntity)
      .save({ id: 'lobby', ownerUserId: 'alice', isPrivate: true });
    await dataSource.getRepository(RoomMembershipEntity).save([
      { roomId: 'lobby', userId: 'alice', role: 'owner' },
      { roomId: 'lobby', userId: 'bob', role: 'member' },
    ]);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('returns duplicate for same clientMsgId', async () => {
    const base = {
      id: randomUUID(),
      clientMsgId: '11111111-1111-4111-8111-111111111111',
      roomId: 'lobby',
      userId: 'alice',
      text: 'hello',
      sentAt: new Date().toISOString(),
    };

    const first = await service.saveMessageIdempotent(base);
    const second = await service.saveMessageIdempotent({
      ...base,
      id: randomUUID(),
      text: 'hello again',
    });

    expect(first.status).toBe('accepted');
    expect(second.status).toBe('duplicate');
    expect(second.message.id).toBe(first.message.id);
  });

  it('assigns monotonic seq and fetches messages after seq', async () => {
    const one = await service.saveMessageIdempotent({
      id: randomUUID(),
      clientMsgId: '22222222-2222-4222-8222-222222222222',
      roomId: 'lobby',
      userId: 'alice',
      text: 'one',
      sentAt: new Date().toISOString(),
    });
    const two = await service.saveMessageIdempotent({
      id: randomUUID(),
      clientMsgId: '33333333-3333-4333-8333-333333333333',
      roomId: 'lobby',
      userId: 'alice',
      text: 'two',
      sentAt: new Date().toISOString(),
    });

    expect(two.message.seq).toBeGreaterThan(one.message.seq);

    const after = await service.getRoomMessagesAfterSeq(
      'lobby',
      'alice',
      one.message.seq,
      50,
    );
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe('two');
  });

  it('resolves user id by nickname', async () => {
    await expect(service.getUserIdByNicknameOrThrow('alice')).resolves.toBe('alice');
    await expect(service.getUserIdByNicknameOrThrow('unknown')).rejects.toThrow(
      'nickname not found',
    );
  });

  it('validates signup profile availability before external signup', async () => {
    await expect(
      service.assertSignupProfileAvailable('new@test.com', 'newbie'),
    ).resolves.toBeUndefined();
    await expect(
      service.assertSignupProfileAvailable('alice@test.com', 'newbie'),
    ).rejects.toThrow('email already used');
    await expect(
      service.assertSignupProfileAvailable('new@test.com', 'alice'),
    ).rejects.toThrow('nickname already used');
  });

  it('creates pending request and accepts to form bidirectional friendship', async () => {
    const created = await service.createFriendRequest('alice', 'bob');
    expect(created.status).toBe('pending');

    const accepted = await service.acceptFriendRequest(created.id, 'bob');
    expect(accepted.status).toBe('accepted');

    const aliceFriends = await service.getFriends('alice');
    const bobFriends = await service.getFriends('bob');
    expect(aliceFriends).toContain('bob');
    expect(bobFriends).toContain('alice');
  });

  it('rejects duplicate pending request for same pair', async () => {
    await service.createFriendRequest('alice', 'bob');
    await expect(service.createFriendRequest('alice', 'bob')).rejects.toThrow(
      'Pending friend request already exists',
    );
  });
});
