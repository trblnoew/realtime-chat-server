# Realtime Chat Server (NestJS + Socket.IO + SQLite)

채널/DM/초대 기능과 메시지 신뢰성(ACK/재전송/중복 제거/재연결 복구)을 포함한 실시간 채팅 서버

## 인증 방식

- Supabase Auth 기반 (`이메일 + 비밀번호`)
- 학습/포트폴리오 목적 기본값: Supabase Email Provider의 `Confirm email` 비활성화(회원가입 후 즉시 로그인)
- 서버 토큰 검증: Supabase `GET /auth/v1/user` 기반 검증
- 인증 진입 경로는 `/login` (로그인/회원가입 탭 UI)
- 보호 API(`/social/**`)는 `Authorization: Bearer <access_token>` 필요
- WebSocket 연결도 JWT 인증 필수 (`io({ auth: { token } })`)
- 앱 DB `users`는 `id=Supabase UUID`, `email`, `nickname`을 저장
- 미로그인 상태에서 `/rt`, `/a/:roomId`, `/b/:peerUserId` 접근 시 `/login?next=...`로 리다이렉트
- 로그인 성공 시 `next` 경로로 복귀, 없거나 유효하지 않으면 `/rt`
- 실서비스 전환 시: Email 확인을 다시 활성화하고 signup 이후 `pending verification` UX 분기 추가 권장

## 메시지 신뢰성 기능

- `message_send` + `message_ack`
- 서버 멱등 키: `(room_id, user_id, client_msg_id)`
- 방 단위 순번 `seq` 정렬
- 재연결 복구: `message_resync` / `message_resync_result`
- 레거시 호환: 서버는 `message_new`와 기존 `message`를 함께 emit

## 친구/DM 도메인 (DB 영속화)

- 친구 관계는 DB 테이블 기반:
  - `friend_requests` (`pending|accepted|rejected`)
  - `friend_edges` (수락 시 양방향 2건 생성)
- 친구 요청 API:
  - `POST /social/friend-requests`
  - `GET /social/friend-requests/incoming`
  - `GET /social/friend-requests/outgoing`
  - `POST /social/friend-requests/:requestId/accept`
  - `POST /social/friend-requests/:requestId/reject`
- 기존 `POST /social/friends`는 호환 레이어로 유지되며, 내부적으로 친구 요청 생성으로 매핑

### Auth

- `POST /auth/signup`
  - body: `{ email, password, nickname }`
- `POST /auth/login`
  - body: `{ email, password }`
- `GET /auth/me`
  - header: `Authorization: Bearer <token>`

### Social

- `GET /social/rooms`
- `GET /social/rooms/:roomId/messages?limit=50&afterSeq=123`
- 기타 친구/초대/DM API

## 실행

```bash
npm install
npm run start:dev
```

접속:

- `http://localhost:3000/login`
- `http://localhost:3000/rt`
- `http://localhost:3000/a/:roomId`
- `http://localhost:3000/b/:peerUserId`

## 테스트

```bash
npm test
npm run test:e2e
```

## CI/CD (GitHub Actions + Render)

### 브랜치/트리거 정책

- CI: `pull_request(main)`, `push(main)`
- CD(Render): `push(main)` 또는 `ci` 워크플로우 성공(`workflow_run`)

### 워크플로우 파일

- `.github/workflows/ci.yml`
  - `npm ci`
  - `npm run lint:check`
  - `npx tsc --noEmit`
  - `npm test -- --runInBand`
  - `npm run test:e2e -- --runInBand`
  - `npm run build`
- `.github/workflows/cd-render.yml`
  - Render Deploy Hook URL 호출
  - 호출 실패 시 workflow 실패 처리

### GitHub Secrets

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `RENDER_DEPLOY_HOOK_URL`

CI는 외부 의존성을 줄이기 위해 `SUPABASE_AUTH_MOCK=true`를 사용합니다.

### Render 연결 절차

1. Render에서 Web Service 생성 후 GitHub 저장소 연결
2. Build Command: `npm ci && npm run build`
3. Start Command: `npm run start:prod`
4. Render 환경변수 설정(`SUPABASE_URL`, `SUPABASE_ANON_KEY` 등)
5. Deploy Hook 생성 후 URL 복사
6. GitHub 저장소 시크릿 `RENDER_DEPLOY_HOOK_URL` 등록
7. `main`에 push하여 자동 배포 동작 확인
