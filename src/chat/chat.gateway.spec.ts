import { WsException } from '@nestjs/websockets';
import { ChatGateway } from './chat.gateway';

describe('ChatGateway', () => {
  const createFixture = () => {
    const chatService = {
      buildMessage: jest.fn(),
    };
    const chatStore = {
      ensureMembership: jest.fn(),
      saveMessageIdempotent: jest.fn(),
      getRoomMessagesAfterSeq: jest.fn(),
    };
    const realtimeNotify = {
      attachServer: jest.fn(),
      unregisterSocket: jest.fn(),
      registerSocket: jest.fn(),
      moveSocket: jest.fn(),
    };
    const supabaseAuth = {
      verifyJwt: jest.fn(),
    };

    const gateway = new ChatGateway(
      chatService as any,
      chatStore as any,
      realtimeNotify as any,
      supabaseAuth as any,
    );
    const roomEmit = jest.fn();
    const globalEmit = jest.fn();
    (gateway as any).server = {
      to: jest.fn(() => ({ emit: roomEmit })),
      emit: globalEmit,
    };
    const client = {
      id: 'socket-1',
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      data: {},
      handshake: {
        auth: { token: 'mock-token' },
        headers: {},
      },
    } as any;

    return { gateway, chatService, chatStore, roomEmit, client, supabaseAuth };
  };

  it('rejects message_send without authenticated socket user', async () => {
    const { gateway, client } = createFixture();
    await expect(
      gateway.handleMessageSend(
        {
          roomId: 'lobby',
          text: 'hello',
          clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
          sentAtClient: new Date().toISOString(),
        },
        client,
      ),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('authenticates socket on connection and emits online users', async () => {
    const { gateway, client, supabaseAuth } = createFixture();
    supabaseAuth.verifyJwt.mockResolvedValue({
      sub: 'user-1',
      email: 'user1@test.com',
    });

    await gateway.handleConnection(client);

    expect(client.data.userId).toBe('user-1');
  });

  it('emits ack accepted and message_new for successful send', async () => {
    const { gateway, chatService, chatStore, roomEmit, client } = createFixture();
    client.data.userId = 'user-1';
    chatService.buildMessage.mockReturnValue({
      id: 's1',
      clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
      roomId: 'lobby',
      userId: 'user-1',
      text: 'hello',
      sentAt: new Date().toISOString(),
    });
    chatStore.saveMessageIdempotent.mockResolvedValue({
      status: 'accepted',
      message: {
        id: 's1',
        clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
        seq: 1,
        roomId: 'lobby',
        userId: 'user-1',
        text: 'hello',
        sentAt: new Date().toISOString(),
      },
    });

    await gateway.handleMessageSend(
      {
        roomId: 'lobby',
        text: 'hello',
        clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
        sentAtClient: new Date().toISOString(),
      },
      client,
    );

    expect(client.emit).toHaveBeenCalledWith(
      'message_ack',
      expect.objectContaining({ status: 'accepted', seq: 1 }),
    );
    expect(roomEmit).toHaveBeenCalledWith(
      'message_new',
      expect.objectContaining({ id: 's1' }),
    );
  });
});
