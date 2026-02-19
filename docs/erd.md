# Realtime Chat SQLite ERD

```mermaid
erDiagram
  users ||--o{ rooms : owns
  users ||--o{ room_memberships : joins
  rooms ||--o{ room_memberships : has
  users ||--o{ messages : sends
  rooms ||--o{ messages : contains

  users {
    text id PK
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
```

## Notes
- `room_memberships` uses a composite primary key: `(room_id, user_id)`.
- `messages.file_*` columns are nullable for text-only messages.
- `file_size` is persisted to align with file upload payload validation and replay.
- `messages` has unique keys for reliability:
  - `(room_id, seq)` for ordering
  - `(room_id, user_id, client_msg_id)` for idempotency
