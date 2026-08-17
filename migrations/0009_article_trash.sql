ALTER TABLE articles ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_deleted_at ON articles (deleted_at);
