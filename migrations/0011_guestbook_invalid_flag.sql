ALTER TABLE guestbook_messages ADD COLUMN invalid INTEGER NOT NULL DEFAULT 0;

UPDATE guestbook_messages
SET invalid = 1,
    status = 'approved'
WHERE status = 'invalid';
