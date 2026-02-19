export class MessageFileDto {
  name!: string;
  mimeType!: string;
  size!: number;
  dataUrl!: string;
}

export class MessageDto {
  text?: string;
  userId?: string;
  roomId?: string;
  file?: MessageFileDto;
  clientMsgId?: string;
  sentAtClient?: string;
}
