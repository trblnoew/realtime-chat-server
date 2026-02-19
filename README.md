# Realtime Chat Server (NestJS + Socket.IO + SQLite)

채널 채팅, DM, 초대 기능을 제공하며 전송 신뢰성 강화를 포함한 실시간 채팅 데모입니다.

## 신뢰성 기능

- 클라이언트 생성 `clientMsgId`를 사용하는 `message_send`
- `message_ack` 상태값 (`accepted`, `duplicate`, `rejected`)
- 서버 측 멱등 키: `(room_id, user_id, client_msg_id)`
- 결정적 정렬을 위한 방 단위 순번 키 `seq`
- 재연결 복구용 `message_resync` / `message_resync_result`
- 레거시 호환: 신규 클라이언트는 `message_new`를 사용하고, 서버는 기존 `message`도 계속 emit

## 설계 의도

- 목표: 불안정한 네트워크 환경에서 메시지 유실/중복을 줄임
- 전략: at-least-once 전송 + 멱등 기반 중복 제거
- 트레이드오프: 분산 환경의 exactly-once 보장은 범위 밖
- 범위: 단일 인스턴스 + SQLite

## 아키텍처 개요

- 백엔드: NestJS Gateway + REST Controller + TypeORM
- 프론트엔드: 정적 HTML + Vanilla JS 모듈
- DB: SQLite (`data/chat.db`)

백엔드 핵심 파일:

- `src/chat/chat.gateway.ts`: WebSocket 계약, ACK/복구 흐름
- `src/chat/chat-store.service.ts`: 멱등 저장, `seq` 할당
- `src/chat/chat.controller.ts`: `afterSeq` 기반 메시지 조회 API

프론트엔드 핵심 파일:

- `public/js/controllers.js`: outbox, 재시도, ACK 처리
- `public/js/socket.js`: WebSocket 이벤트 바인딩
- `public/js/state.js`: 방별 pending outbox, seq/메시지 캐시

## 메시지 계약

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
  - `seq`를 포함한 서버 저장 기준의 정식 메시지 이벤트

- `message_resync_result`
  - `roomId`
  - `messages[]` (`seq` 오름차순)

## REST API

- `GET /social/rooms/:roomId/messages?limit=50&afterSeq=123`
- 기존 social/auth API는 그대로 사용 가능

## 실행 방법

```bash
npm install
npm run start:dev
```

접속 URL:

- `http://localhost:3000/rt`
- `http://localhost:3000/a/:roomId`
- `http://localhost:3000/b/:peerUserId`

## 테스트

```bash
npm test
npm run test:e2e
```

