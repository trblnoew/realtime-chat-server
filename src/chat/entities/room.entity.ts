import { CreateDateColumn, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('rooms')
export class RoomEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ name: 'owner_user_id', type: 'text' })
  ownerUserId!: string;

  @Column({ name: 'is_private', type: 'boolean', default: true })
  isPrivate!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
