-- 001_api_tokens.sql
-- Per-agent access tokens for the MCP door.
--
-- One token = one agent (Claude Code, Codex, a bot). The raw token is shown
-- once when created; only its SHA-256 hash is stored, so a database leak does
-- not hand anyone a working token.
--
-- scope_id: NULL means the token can reach every scope in the workspace.
--          Otherwise the token is fenced to that one scope.
-- can_read / can_write: the permission line. A reviewer bot that only needs to
--          read context gets can_write = false.

CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, -- sha256 hex of the raw token
  token_prefix TEXT NOT NULL,      -- first chars, safe to display
  scope_id UUID REFERENCES scopes(id),
  can_read BOOLEAN NOT NULL DEFAULT true,
  can_write BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
