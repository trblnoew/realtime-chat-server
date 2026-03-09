import { CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('friend_edges')
@Index('idx_friend_edges_friend_user_id', ['friendUserId'])
export class FriendEdgeEntity {
  @PrimaryColumn({ name: 'user_id', type: 'text' })
  userId!: string;

  @PrimaryColumn({ name: 'friend_user_id', type: 'text' })
  friendUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
