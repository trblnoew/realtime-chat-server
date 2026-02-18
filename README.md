# Realtime Chat Server (NestJS + WebSocket + SQLite)

실시간 채팅 서버 포트폴리오 프로젝트입니다.  
NestJS(WebSocket Gateway) + Socket.IO + SQLite(TypeORM) 기반으로 동작합니다.

## 핵심 기능
- RT / A / B 3개 화면 모드
- 회원가입/로그인 (ID 기반, `rt_auth_user` 쿠키)
- 채널 채팅(A) + DM 채팅(B)
- 방 생성 / 친구 추가 / 방 초대
- RT 초대 알람에서 `Y/N` 수락/거절
- 파일 첨부 메시지(최대 5MB, data URL 저장)
- URL 기반 화면 복원
  - `/rt`
  - `/a/:roomId`
  - `/b/:peerUserId`

## 기술 스택
- Backend: NestJS 11, Socket.IO, TypeORM
- Database: SQLite (`data/chat.db`)
- Frontend: Static HTML + Vanilla JS (ES Modules)

## 프로젝트 구조
```text
src/
  chat/
    chat.gateway.ts
    chat.controller.ts
    chat-store.service.ts
    entities/
public/
  index.html
  js/
    main.js
    controllers.js
    router.js
    socket.js
    api.js
    state.js
    dom.js
    renderers.js
database/
  schema.sql
docs/
  erd.md
```

## 실행 방법
```bash
npm install
npm run start:dev
```

기본 접속:
- `http://localhost:3000/rt`

## 데이터베이스
- 런타임 DB 파일: `data/chat.db`
- 참고 스키마: `database/schema.sql`
- ERD: `docs/erd.md`

`src/app.module.ts`에서 TypeORM `synchronize: true`로 동작하므로 엔티티 기준으로 테이블이 자동 반영됩니다.

## 최근 UI/동작 정리
- A/B 채팅창 기능 정렬
  - 메시지 입력/전송/파일첨부
  - Enter 전송
  - 스크롤이 아래가 아닐 때 `Jump Latest` 버튼 표시
- B 좌측 DM 리스트 unread 표시 보정
  - 현재 활성 DM은 unread 0으로 처리
  - 읽음 시점 저장 로직 보강(`sentAt` 기반)

## 검증 체크리스트
1. 로그인 후 `/a/:roomId`, `/b/:peerUserId` 새로고침 시 화면 복원
2. RT 초대 알람 `Y/N` 정상 동작
3. A/B 모두 스크롤 위에서 새 메시지 수신 시 `Jump Latest` 동작
4. B 활성 DM에서 좌측 unread가 고정 `1`로 남지 않는지 확인

## 참고
- 빌드/타입체크:
```bash
npm run build
npx tsc --noEmit --incremental false
```
