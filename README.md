# Realtime Chat Server (NestJS + Socket.IO + SQLite)

Realtime chat demo with channel chat, DM, invites, and reliability-focused message delivery.

## Reliability Features

- `message_send` with client-generated `clientMsgId`
- `message_ack` status (`accepted`, `duplicate`, `rejected`)
- server-side idempotency key: `(room_id, user_id, client_msg_id)`
- room sequence key `seq` for deterministic ordering
- `message_resync` / `message_resync_result` for reconnect recovery
- legacy compatibility: server still emits `message` while new clients use `message_new`

## Why This Design

- Goal: reduce message loss/duplication in unstable networks.
- Strategy: at-least-once delivery + deduplication (idempotency).
- Tradeoff: this is not distributed exactly-once semantics.
- Scope: single instance + SQLite.

## Architecture Notes

- Backend: NestJS gateway + REST controllers + TypeORM
- Frontend: static HTML + vanilla JS modules
- DB: SQLite (`data/chat.db`)

Key backend files:

- `src/chat/chat.gateway.ts`: websocket contract and ACK/resync flow
- `src/chat/chat-store.service.ts`: idempotent persistence and seq allocation
- `src/chat/chat.controller.ts`: message list API with `afterSeq`

Key frontend files:

- `public/js/controllers.js`: outbox, retries, ACK handling
- `public/js/socket.js`: websocket event wiring
- `public/js/state.js`: pending outbox and per-room seq/message cache

## Message Contract

### Client -> Server

- `message_send`
  - `clientMsgId: string` (UUID)
  - `roomId: string`
  - `text?: string`
  - `file?: { name, mimeType, size, dataUrl }`
  - `sentAtClient: string` (ISO)

- `message_resync`
  - `roomId: string`
  - `afterSeq?: number`

### Server -> Client

- `message_ack`
  - `clientMsgId`
  - `serverMsgId`
  - `roomId`
  - `seq`
  - `status: accepted | duplicate | rejected`
  - `reason?`

- `message_new`
  - canonical stored message payload including `seq`

- `message_resync_result`
  - `roomId`
  - `messages[]` (ordered by `seq`)

## REST API

- `GET /social/rooms/:roomId/messages?limit=50&afterSeq=123`
- Existing social/auth APIs remain available.

## Run

```bash
npm install
npm run start:dev
```

Open:

- `http://localhost:3000/rt`
- `http://localhost:3000/a/:roomId`
- `http://localhost:3000/b/:peerUserId`

## Tests

```bash
npm test
npm run test:e2e
```

## Limitations

- Single-node reliability only.
- No external queue/broker.
- No end-to-end encryption.
