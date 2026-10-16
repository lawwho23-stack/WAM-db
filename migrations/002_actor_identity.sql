-- 002_actor_identity.sql
-- Give each agent its own row in `actors`.
--
-- Before this, every write made through the MCP door was attributed to one
-- generic 'agent' actor, so history could not say which agent wrote what. Now
-- the token name becomes an actor of its own ("claude-code", "codex", ...).
--
-- The unique index also makes "find or create" a single atomic upsert.

CREATE UNIQUE INDEX IF NOT EXISTS uq_actors_workspace_kind_name
  ON actors (workspace_id, kind, display_name);
