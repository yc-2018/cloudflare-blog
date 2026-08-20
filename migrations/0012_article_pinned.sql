ALTER TABLE articles ADD COLUMN pinned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_pinned_at ON articles (pinned_at);
