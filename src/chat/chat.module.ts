import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { RealtimeNotifyService } from './realtime-notify.service';
import { ChatStoreService } from './chat-store.service';
import { ChatService } from './chat.service';
import { SupabaseAuthService } from '../auth/supabase-auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MessageEntity } from './entities/message.entity';
import { RoomEntity } from './entities/room.entity';
import { RoomMembershipEntity } from './entities/room-membership.entity';
import { RoomReadStateEntity } from './entities/room-read-state.entity';
import { UserEntity } from './entities/user.entity';
import { FriendRequestEntity } from './entities/friend-request.entity';
import { FriendEdgeEntity } from './entities/friend-edge.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      RoomEntity,
      RoomMembershipEntity,
      MessageEntity,
      RoomReadStateEntity,
      FriendRequestEntity,
      FriendEdgeEntity,
    ]),
  ],
  controllers: [AuthController, ChatController],
  providers: [
    ChatGateway,
    ChatService,
    ChatStoreService,
    RealtimeNotifyService,
    SupabaseAuthService,
    JwtAuthGuard,
  ],
})
export class ChatModule {}
