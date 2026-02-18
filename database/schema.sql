PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  is_private INTEGER NOT NULL DEFAULT 1 CHECK (is_private IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS room_memberships (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  file_name TEXT NULL,
  file_mime_type TEXT NULL,
  file_size INTEGER NULL,
  file_data_url TEXT NULL,
  sent_at DATETIME NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS room_read_states (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_message_id TEXT NULL,
  last_read_at DATETIME NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (last_read_message_id) REFERENCES messages(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_memberships_user_id
  ON room_memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_messages_room_sent_at
  ON messages (room_id, sent_at);

CREATE INDEX IF NOT EXISTS idx_messages_user_id
  ON messages (user_id);

CREATE INDEX IF NOT EXISTS idx_room_read_states_user_id
  ON room_read_states (user_id);

CREATE INDEX IF NOT EXISTS idx_room_read_states_room_user
  ON room_read_states (room_id, user_id);
