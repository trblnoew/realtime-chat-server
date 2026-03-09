# Realtime Chat SQLite ERD

```mermaid
erDiagram
  users ||--o{ rooms : owns
  users ||--o{ room_memberships : joins
  rooms ||--o{ room_memberships : has
  users ||--o{ messages : sends
  rooms ||--o{ messages : contains
  users ||--o{ friend_requests : sends
  users ||--o{ friend_requests : receives
  users ||--o{ friend_edges : has

  users {
    text id PK
    text email unique
    text nickname unique
    datetime created_at
  }

  rooms {
    text id PK
    text owner_user_id FK
    boolean is_private
    datetime created_at
  }

  room_memberships {
    text room_id PK,FK
    text user_id PK,FK
    text role "owner|member"
    datetime joined_at
  }

  messages {
    text id PK
    text room_id FK
    text user_id FK
    text client_msg_id nullable
    integer seq nullable
    text text
    text file_name nullable
    text file_mime_type nullable
    integer file_size nullable
    text file_data_url nullable
    datetime sent_at
  }

  friend_requests {
    text id PK
    text from_user_id FK
    text to_user_id FK
    text status "pending|accepted|rejected"
    datetime created_at
    datetime responded_at nullable
  }

  friend_edges {
    text user_id PK,FK
    text friend_user_id PK,FK
    datetime created_at
  }
```

## Notes
- `room_memberships` uses a composite primary key: `(room_id, user_id)`.
- `messages.file_*` columns are nullable for text-only messages.
- `file_size` is persisted to align with file upload payload validation and replay.
- `messages` has unique keys for reliability:
  - `(room_id, seq)` for ordering
  - `(room_id, user_id, client_msg_id)` for idempotency
- `friend_requests` drives request state transitions; accepted requests create two `friend_edges` rows.
