/**
 * ITokenStore & IIntegrationRepository
 * -----------------------------------------------------------------------------
 * Persistence-facing interfaces. The service layer depends on THESE, not on
 * `pg` or the concrete SQL. That keeps two things possible without touching
 * the business logic:
 *
 *   1. Swapping Postgres for another store in tests (an in-memory fake is
 *      enough).
 *   2. Swapping the token encryption strategy (see security/TokenEncryptor)
 *      because the store just accepts opaque strings and returns them.
 *
 * SOLID: Dependency Inversion + Single Responsibility. The token store's
 * only job is CRUD on encrypted credentials; it doesn't know how they were
 * encrypted, and it doesn't know what business object they belong to beyond
 * the integration id.
 */

import type { ScmPlatform } from "./IScmProvider.js";

export interface StoredTokenRecord {
  integrationId: string;
  platform: ScmPlatform;
  /** Ciphertext blob produced by TokenEncryptor. Opaque to this layer. */
  ciphertext: string;
  refreshCiphertext?: string | null;
  scope: string;
  accessTokenExpiresAt?: string | null;
  updatedAt: string;
}

export interface ITokenStore {
  save(record: Omit<StoredTokenRecord, "updatedAt">): Promise<void>;
  get(integrationId: string): Promise<StoredTokenRecord | null>;
  delete(integrationId: string): Promise<void>;
}

export interface IntegrationRecord {
  id: string;
  ownerUserId: string;              // our internal user id from the main backend
  platform: ScmPlatform;
  targetKind: "repository" | "organization";
  targetOwner: string;
  targetRepo: string | null;
  externalUserId: string;           // github user id / gitlab user id
  externalUserLogin: string;
  webhookExternalId: string | null;
  webhookSecretCiphertext: string | null;
  status: "pending" | "authorized" | "connected" | "revoked" | "error";
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IIntegrationRepository {
  create(record: Omit<IntegrationRecord, "createdAt" | "updatedAt">): Promise<void>;
  update(id: string, patch: Partial<IntegrationRecord>): Promise<void>;
  findById(id: string): Promise<IntegrationRecord | null>;
  findByOwnerAndTarget(args: {
    ownerUserId: string;
    platform: ScmPlatform;
    targetOwner: string;
    targetRepo: string | null;
  }): Promise<IntegrationRecord | null>;
}
