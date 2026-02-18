import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('room_read_states')
@Index('idx_room_read_states_user_id', ['userId'])
@Index('idx_room_read_states_room_user', ['roomId', 'userId'])
export class RoomReadStateEntity {
  @PrimaryColumn({ name: 'room_id', type: 'text' })
  roomId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'last_read_message_id', type: 'text', nullable: true })
  lastReadMessageId!: string | null;

  @Column({ name: 'last_read_at', type: 'datetime', nullable: true })
  lastReadAt!: Date | null;
}
