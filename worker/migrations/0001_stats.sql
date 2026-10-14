-- Additive migration: never drops existing game records.
CREATE TABLE IF NOT EXISTS game_runs (
  run_id TEXT PRIMARY KEY,
  level_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  start_mode TEXT NOT NULL CHECK(start_mode IN ('easy', 'hard')),
  started_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'solved', 'revealed')),
  finished_at INTEGER,
  elapsed_ms INTEGER,
  finished_mode TEXT,
  ever_assisted INTEGER NOT NULL DEFAULT 0,
  lookup_count INTEGER NOT NULL DEFAULT 0,
  reveal_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS game_runs_level ON game_runs(level_id, revision, started_at);
CREATE TABLE IF NOT EXISTS level_stats (
  level_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  starts INTEGER NOT NULL DEFAULT 0,
  solved INTEGER NOT NULL DEFAULT 0,
  elapsed_total_ms INTEGER NOT NULL DEFAULT 0,
  challenge_solved INTEGER NOT NULL DEFAULT 0,
  challenge_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(level_id, revision)
);
CREATE TRIGGER IF NOT EXISTS game_run_started AFTER INSERT ON game_runs
BEGIN
  INSERT INTO level_stats(level_id, revision, starts) VALUES(NEW.level_id, NEW.revision, 1)
  ON CONFLICT(level_id, revision) DO UPDATE SET starts = starts + 1;
END;
CREATE TRIGGER IF NOT EXISTS game_run_solved AFTER UPDATE OF status ON game_runs
WHEN OLD.status = 'active' AND NEW.status = 'solved'
BEGIN
  UPDATE level_stats SET solved = solved + 1, elapsed_total_ms = elapsed_total_ms + NEW.elapsed_ms,
    challenge_solved = challenge_solved + CASE WHEN NEW.ever_assisted = 0 THEN 1 ELSE 0 END,
    challenge_elapsed_ms = challenge_elapsed_ms + CASE WHEN NEW.ever_assisted = 0 THEN NEW.elapsed_ms ELSE 0 END
  WHERE level_id = NEW.level_id AND revision = NEW.revision;
END;
