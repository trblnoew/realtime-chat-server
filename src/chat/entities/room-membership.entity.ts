import {
  CreateDateColumn,
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type RoomMembershipRole = 'owner' | 'member';

@Entity('room_memberships')
@Index('idx_room_memberships_user_id', ['userId'])
export class RoomMembershipEntity {
  @PrimaryColumn({ name: 'room_id', type: 'text' })
  roomId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({
    type: 'simple-enum',
    enum: ['owner', 'member'],
  })
  role!: RoomMembershipRole;

  @CreateDateColumn({ name: 'joined_at', type: 'datetime' })
  joinedAt!: Date;
}
