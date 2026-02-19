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
      loginUser: jest.fn(),
    };
    const realtimeNotify = {
      attachServer: jest.fn(),
      unregisterSocket: jest.fn(),
      registerSocket: jest.fn(),
      moveSocket: jest.fn(),
    };

    const gateway = new ChatGateway(
      chatService as any,
      chatStore as any,
      realtimeNotify as any,
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
    } as any;

    return { gateway, chatService, chatStore, roomEmit, client };
  };

  it('rejects message_send without login', async () => {
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

  it('emits ack accepted and message_new for successful send', async () => {
    const { gateway, chatService, chatStore, roomEmit, client } = createFixture();
    chatStore.loginUser.mockResolvedValue({ userId: 'alice' });
    await gateway.handleSetUser({ userId: 'alice' }, client);
    chatService.buildMessage.mockReturnValue({
      id: 's1',
      clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
      roomId: 'lobby',
      userId: 'alice',
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
        userId: 'alice',
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

  it('emits duplicate ack without extra broadcast', async () => {
    const { gateway, chatService, chatStore, roomEmit, client } = createFixture();
    chatStore.loginUser.mockResolvedValue({ userId: 'alice' });
    await gateway.handleSetUser({ userId: 'alice' }, client);
    chatService.buildMessage.mockReturnValue({
      id: 's1',
      clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
      roomId: 'lobby',
      userId: 'alice',
      text: 'hello',
      sentAt: new Date().toISOString(),
    });
    chatStore.saveMessageIdempotent.mockResolvedValue({
      status: 'duplicate',
      message: {
        id: 's1',
        clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
        seq: 1,
        roomId: 'lobby',
        userId: 'alice',
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
      expect.objectContaining({ status: 'duplicate' }),
    );
    expect(roomEmit).not.toHaveBeenCalledWith(
      'message_new',
      expect.anything(),
    );
  });

  it('normalizes legacy message event', async () => {
    const { gateway, chatService, chatStore, roomEmit, client } = createFixture();
    chatStore.loginUser.mockResolvedValue({ userId: 'alice' });
    await gateway.handleSetUser({ userId: 'alice' }, client);
    chatService.buildMessage.mockReturnValue({
      id: 'legacy-1',
      clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
      roomId: 'lobby',
      userId: 'alice',
      text: 'legacy',
      sentAt: new Date().toISOString(),
    });
    chatStore.saveMessageIdempotent.mockResolvedValue({
      status: 'accepted',
      message: {
        id: 'legacy-1',
        clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
        seq: 1,
        roomId: 'lobby',
        userId: 'alice',
        text: 'legacy',
        sentAt: new Date().toISOString(),
      },
    });

    await gateway.handleLegacyMessage({ roomId: 'lobby', text: 'legacy' }, client);

    expect(roomEmit).toHaveBeenCalledWith(
      'message',
      expect.objectContaining({ id: 'legacy-1' }),
    );
    expect(roomEmit).toHaveBeenCalledWith(
      'message_new',
      expect.objectContaining({ id: 'legacy-1' }),
    );
  });
});
