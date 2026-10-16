import { sql, getScope, getActorByKind } from "./db";

// Skills = reusable procedures an agent can load. Only the description is
// searched in bulk; the body is fetched one skill at a time so it stays out of
// the context window until it is actually needed.

export async function searchSkills(scopeName: string, q = "") {
  const db = sql();
  const scope = await getScope(scopeName);
  if (!q.trim()) return listSkills(scopeName);
  const like = `%${q.trim()}%`;
  return db`
    SELECT s.command, sv.title, sv.description, sv.version
    FROM skills s
    JOIN skill_versions sv ON sv.skill_id = s.id AND sv.version = s.active_version
    WHERE s.scope_id = ${scope.id} AND s.revoked = false
      AND (s.command ILIKE ${like} OR sv.title ILIKE ${like} OR sv.description ILIKE ${like})
    ORDER BY s.command
    LIMIT 20`;
}

export async function listSkills(scopeName: string) {
  const db = sql();
  const scope = await getScope(scopeName);
  return db`
    SELECT s.command, sv.title, sv.description, sv.version
    FROM skills s
    JOIN skill_versions sv ON sv.skill_id = s.id AND sv.version = s.active_version
    WHERE s.scope_id = ${scope.id} AND s.revoked = false
    ORDER BY s.command
    LIMIT 100`;
}

export async function getSkill(scopeName: string, command: string) {
  const db = sql();
  const scope = await getScope(scopeName);
  const rows = await db`
    SELECT s.command, sv.title, sv.description, sv.body, sv.version, s.revoked
    FROM skills s
    JOIN skill_versions sv ON sv.skill_id = s.id AND sv.version = s.active_version
    WHERE s.scope_id = ${scope.id} AND s.command = ${command}
    LIMIT 1`;
  if (rows.length === 0) throw new Error(`Skill '${command}' not found in scope '${scopeName}'.`);
  const row = rows[0] as { revoked: boolean };
  if (row.revoked) throw new Error(`Skill '${command}' is revoked.`);
  return rows[0];
}

/** Publish a new skill, or a new version of an existing one. */
export async function upsertSkill(input: {
  scope: string;
  command: string;
  title: string;
  description: string;
  body: string;
}) {
  const db = sql();
  const scope = await getScope(input.scope);
  const actorId = await getActorByKind(scope.workspace_id, "owner");

  const found = await db`SELECT id, active_version FROM skills WHERE scope_id = ${scope.id} AND command = ${input.command} LIMIT 1`;

  let skillId: string;
  let version: number;
  if (found.length === 0) {
    const r = await db`INSERT INTO skills (workspace_id, scope_id, command, revision, active_version)
      VALUES (${scope.workspace_id}, ${scope.id}, ${input.command}, 1, 1) RETURNING id`;
    skillId = r[0].id as string;
    version = 1;
  } else {
    skillId = found[0].id as string;
    const mx = await db`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM skill_versions WHERE skill_id = ${skillId}`;
    version = mx[0].v as number;
    await db`UPDATE skills SET revision = revision + 1, active_version = ${version}, revoked = false WHERE id = ${skillId}`;
  }

  await db`INSERT INTO skill_versions (skill_id, workspace_id, version, title, description, body, created_by)
    VALUES (${skillId}, ${scope.workspace_id}, ${version}, ${input.title}, ${input.description}, ${input.body}, ${actorId})`;

  return { skill_id: skillId, version };
}

export async function revokeSkill(scopeName: string, command: string) {
  const db = sql();
  const scope = await getScope(scopeName);
  const rows = await db`UPDATE skills SET revoked = true WHERE scope_id = ${scope.id} AND command = ${command} RETURNING id`;
  if (rows.length === 0) throw new Error(`Skill '${command}' not found.`);
  return { command, revoked: true };
}
