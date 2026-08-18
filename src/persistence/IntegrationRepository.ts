/**
 * PostgresIntegrationRepository
 * -----------------------------------------------------------------------------
 * Concrete implementation of IIntegrationRepository. Same principles as the
 * token store: no crypto, no business logic — just SQL.
 */

import type {
  IIntegrationRepository,
  IntegrationRecord,
} from "../domain/interfaces/ITokenStore.js";
import { query } from "./db.js";

export class PostgresIntegrationRepository implements IIntegrationRepository {
  async create(record: Omit<IntegrationRecord, "createdAt" | "updatedAt">): Promise<void> {
    await query(
      `INSERT INTO integrations
         (id, owner_user_id, platform, target_kind, target_owner, target_repo,
          external_user_id, external_user_login,
          webhook_external_id, webhook_secret_ciphertext, status, last_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        record.id,
        record.ownerUserId,
        record.platform,
        record.targetKind,
        record.targetOwner,
        record.targetRepo,
        record.externalUserId,
        record.externalUserLogin,
        record.webhookExternalId,
        record.webhookSecretCiphertext,
        record.status,
        record.lastError ?? null,
      ],
    );
  }

  async update(id: string, patch: Partial<IntegrationRecord>): Promise<void> {
    // Build a minimal parameterised UPDATE. Only touch columns present in patch.
    const mapping: Record<string, string> = {
      status: "status",
      lastError: "last_error",
      webhookExternalId: "webhook_external_id",
      webhookSecretCiphertext: "webhook_secret_ciphertext",
      externalUserId: "external_user_id",
      externalUserLogin: "external_user_login",
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, col] of Object.entries(mapping)) {
      if (k in patch) {
        sets.push(`${col} = $${i++}`);
        values.push((patch as Record<string, unknown>)[k]);
      }
    }
    if (sets.length === 0) return;
    sets.push(`updated_at = NOW()`);
    values.push(id);
    await query(
      `UPDATE integrations SET ${sets.join(", ")} WHERE id = $${i}`,
      values,
    );
  }

  async findById(id: string): Promise<IntegrationRecord | null> {
    const res = await query<IntegrationRow>(
      `SELECT * FROM integrations WHERE id = $1`,
      [id],
    );
    if (res.rowCount === 0) return null;
    return rowToRecord(res.rows[0]);
  }

  async findByOwnerAndTarget(args: {
    ownerUserId: string;
    platform: IntegrationRecord["platform"];
    targetOwner: string;
    targetRepo: string | null;
  }): Promise<IntegrationRecord | null> {
    const res = await query<IntegrationRow>(
      `SELECT * FROM integrations
       WHERE owner_user_id = $1
         AND platform = $2
         AND target_owner = $3
         AND COALESCE(target_repo, '') = COALESCE($4, '')
       LIMIT 1`,
      [args.ownerUserId, args.platform, args.targetOwner, args.targetRepo],
    );
    if (res.rowCount === 0) return null;
    return rowToRecord(res.rows[0]);
  }
}

// Row shape as returned by the driver (snake_case).
interface IntegrationRow {
  id: string;
  owner_user_id: string;
  platform: string;
  target_kind: string;
  target_owner: string;
  target_repo: string | null;
  external_user_id: string;
  external_user_login: string;
  webhook_external_id: string | null;
  webhook_secret_ciphertext: string | null;
  status: string;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToRecord(r: IntegrationRow): IntegrationRecord {
  return {
    id: r.id,
    ownerUserId: r.owner_user_id,
    platform: r.platform as IntegrationRecord["platform"],
    targetKind: r.target_kind as IntegrationRecord["targetKind"],
    targetOwner: r.target_owner,
    targetRepo: r.target_repo,
    externalUserId: r.external_user_id,
    externalUserLogin: r.external_user_login,
    webhookExternalId: r.webhook_external_id,
    webhookSecretCiphertext: r.webhook_secret_ciphertext,
    status: r.status as IntegrationRecord["status"],
    lastError: r.last_error,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
