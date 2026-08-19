ALTER TABLE guestbook_messages RENAME TO guestbook_messages_old;

CREATE TABLE guestbook_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES guestbook_messages(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  author_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reply_to_nickname TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'invalid')),
  article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE
);

INSERT INTO guestbook_messages (id, parent_id, nickname, email, content, author_hash, created_at, reply_to_nickname, status, article_id)
SELECT id, parent_id, nickname, email, content, author_hash, created_at, reply_to_nickname, status, article_id
FROM guestbook_messages_old;

DROP TABLE guestbook_messages_old;

CREATE INDEX IF NOT EXISTS idx_guestbook_messages_parent_created_at ON guestbook_messages (parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guestbook_messages_author_created_at ON guestbook_messages (author_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guestbook_messages_status_parent_created_at ON guestbook_messages (status, parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guestbook_messages_article_parent_created_at ON guestbook_messages (article_id, parent_id, created_at);
