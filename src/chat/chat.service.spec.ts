import { BadRequestException } from '@nestjs/common';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  const service = new ChatService();
  const socket = { id: 'socket-1' } as any;

  it('rejects invalid clientMsgId', () => {
    expect(() =>
      service.buildMessage(socket, {
        roomId: 'lobby',
        text: 'hello',
        sentAtClient: new Date().toISOString(),
        clientMsgId: 'not-uuid',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects empty text and file', () => {
    expect(() =>
      service.buildMessage(socket, {
        roomId: 'lobby',
        sentAtClient: new Date().toISOString(),
        clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
      }),
    ).toThrow(BadRequestException);
  });

  it('builds normalized payload', () => {
    const payload = service.buildMessage(socket, {
      roomId: 'lobby',
      text: 'hi',
      sentAtClient: new Date().toISOString(),
      clientMsgId: '9f48fdf7-8d36-4d9d-8ff8-3476f42da57e',
    });
    expect(payload.roomId).toBe('lobby');
    expect(payload.clientMsgId).toBe('9f48fdf7-8d36-4d9d-8ff8-3476f42da57e');
    expect(payload.text).toBe('hi');
  });
});
