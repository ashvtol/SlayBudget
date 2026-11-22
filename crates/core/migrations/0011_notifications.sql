-- Notification center: one row per event (unique key, so an event never notifies twice, even after dismissal).
CREATE TABLE notifications (
    id           INTEGER PRIMARY KEY,
    key          TEXT NOT NULL UNIQUE,
    kind         TEXT NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    target       TEXT NOT NULL,             -- JSON: where clicking it goes
    profile_id   INTEGER REFERENCES profiles(id) ON DELETE CASCADE,  -- NULL: all profiles / the app
    created_at   TEXT NOT NULL,
    read_at      TEXT,
    dismissed_at TEXT,
    delivered_at TEXT                       -- when its macOS banner was shown (or skipped)
);
CREATE INDEX idx_notifications_created ON notifications(created_at);
