PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

BEGIN TRANSACTION;

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');

COMMIT;
