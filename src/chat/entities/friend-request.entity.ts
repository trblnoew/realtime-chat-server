import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected';

@Entity('friend_requests')
@Index('idx_friend_requests_to_status', ['toUserId', 'status', 'createdAt'])
@Index('idx_friend_requests_from_status', ['fromUserId', 'status', 'createdAt'])
export class FriendRequestEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ name: 'from_user_id', type: 'text' })
  fromUserId!: string;

  @Column({ name: 'to_user_id', type: 'text' })
  toUserId!: string;

  @Column({
    type: 'simple-enum',
    enum: ['pending', 'accepted', 'rejected'],
  })
  status!: FriendRequestStatus;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @Column({ name: 'responded_at', type: 'datetime', nullable: true })
  respondedAt!: Date | null;
}
