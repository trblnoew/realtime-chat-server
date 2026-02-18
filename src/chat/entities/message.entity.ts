import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('messages')
@Index('idx_messages_user_id', ['userId'])
@Index('idx_messages_room_sent_at', ['roomId', 'sentAt'])
export class MessageEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ name: 'room_id', type: 'text' })
  roomId!: string;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ name: 'file_name', type: 'text', nullable: true })
  fileName!: string | null;

  @Column({ name: 'file_mime_type', type: 'text', nullable: true })
  fileMimeType!: string | null;

  @Column({ name: 'file_size', type: 'integer', nullable: true })
  fileSize!: number | null;

  @Column({ name: 'file_data_url', type: 'text', nullable: true })
  fileDataUrl!: string | null;

  @Column({ name: 'sent_at', type: 'datetime' })
  sentAt!: Date;
}
