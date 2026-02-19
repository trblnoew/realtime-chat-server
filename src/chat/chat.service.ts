import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Socket } from 'socket.io';
import { MessageDto } from './dto/message.dto';

@Injectable()
export class ChatService {
  private readonly uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  buildMessage(client: Socket, data: MessageDto) {
    const text = (data.text ?? '').trim();
    const file = data.file ? this.normalizeFile(data.file) : undefined;
    const roomId = (data.roomId ?? 'lobby').trim() || 'lobby';
    const clientMsgId = (data.clientMsgId ?? '').trim();
    const sentAtClient = (data.sentAtClient ?? '').trim();

    if (!text && !file) {
      throw new BadRequestException('Message text or file is required');
    }
    if (!clientMsgId || !this.uuidPattern.test(clientMsgId)) {
      throw new BadRequestException('Invalid clientMsgId');
    }
    if (!sentAtClient || Number.isNaN(Date.parse(sentAtClient))) {
      throw new BadRequestException('Invalid sentAtClient');
    }

    return {
      id: randomUUID(),
      clientMsgId,
      roomId,
      text: text || (file ? '[file]' : ''),
      userId: data.userId ?? client.id,
      sentAt: new Date().toISOString(),
      file,
    };
  }

  private normalizeFile(file: MessageDto['file']) {
    if (!file) return undefined;
    const name = (file.name ?? '').trim();
    const mimeType = (file.mimeType ?? 'application/octet-stream').trim();
    const size = Number(file.size ?? 0);
    const dataUrl = (file.dataUrl ?? '').trim();

    if (!name || !dataUrl || !Number.isFinite(size) || size <= 0) {
      throw new BadRequestException('Invalid file payload');
    }

    const maxBytes = 5 * 1024 * 1024;
    if (size > maxBytes) {
      throw new BadRequestException('File size exceeds 5MB');
    }

    return {
      name,
      mimeType,
      size,
      dataUrl,
    };
  }
}
