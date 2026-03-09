import { CreateDateColumn, Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('users')
@Index('uq_users_email', ['email'], { unique: true })
@Index('uq_users_nickname', ['nickname'], { unique: true })
export class UserEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text' })
  nickname!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
