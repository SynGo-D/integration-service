/**
 * OAuthOrchestrator
 * -----------------------------------------------------------------------------
 * Coordinates the OAuth "dance" for FR-02.3, FR-02.6, FR-02.7, FR-02.8:
 *
 *   1. startAuthorization  — build authorization URL + signed state, return
 *                            them to the caller (the Main Backend).
 *   2. completeAuthorization — verify state, exchange code, fetch identity,
 *                            encrypt & persist tokens, create integration
 *                            record in status "authorized".
 *
 * SOLID:
 *   - SRP: this class ONLY orchestrates the OAuth handshake. Webhook
 *     registration is a separate service (RepositoryConnectService) so
 *     failure in one doesn't couple to the other.
 *   - DIP: takes ProviderFactory, StateSigner, TokenEncryptor,
 *     IIntegrationRepository, ITokenStore through the constructor. No
 *     `new` calls to concrete providers here.
 */

import { randomUUID } from "node:crypto";
import type { ProviderFactory } from "../providers/ProviderFactory.js";
import type { StateSigner } from "../security/StateSigner.js";
import type { TokenEncryptor } from "../security/TokenEncryptor.js";
import type {
  IIntegrationRepository,
  ITokenStore,
} from "../domain/interfaces/ITokenStore.js";
import type {
  OAuthAuthorizationRequest,
  ScmPlatform,
  ScmTarget,
} from "../domain/interfaces/IScmProvider.js";

export interface StartAuthorizationInput {
  userId: string;             // internal user id from Main Backend session
  platform: ScmPlatform;
  target: ScmTarget;          // already parsed & previewed
  returnTo?: string;          // frontend url to send user back to after callback
  redirectUri: string;        // OAuth redirect_uri — public URL of our callback route
}

export interface CompleteAuthorizationInput {
  userId: string;
  platform: ScmPlatform;
  code: string;
  state: string;
  redirectUri: string;
}

export interface CompleteAuthorizationResult {
  integrationId: string;
  externalUserLogin: string;
  returnTo?: string;
}

export class OAuthOrchestrator {
  constructor(
    private readonly factory: ProviderFactory,
    private readonly stateSigner: StateSigner,
    private readonly encryptor: TokenEncryptor,
    private readonly integrations: IIntegrationRepository,
    private readonly tokens: ITokenStore,
  ) {}

  startAuthorization(input: StartAuthorizationInput): OAuthAuthorizationRequest {
    const state = this.stateSigner.sign({
      userId: input.userId,
      platform: input.platform,
      returnTo: input.returnTo,
    });
    const provider = this.factory.getProvider(input.platform);
    return provider.buildAuthorizationUrl(state, input.redirectUri);
  }

  async completeAuthorization(
    input: CompleteAuthorizationInput,
  ): Promise<CompleteAuthorizationResult> {
    // 1. Verify state — defeats CSRF, ensures the callback belongs to THIS user.
    const payload = this.stateSigner.verify(input.state, input.userId, input.platform);

    // 2. Exchange code for tokens.
    const provider = this.factory.getProvider(input.platform);
    const tokens = await provider.exchangeCodeForTokens(input.code, input.redirectUri);

    // 3. Identify who authorised.
    const identity = await provider.fetchAuthenticatedUser(tokens.accessToken);

    // 4. Create (or update) integration record in "authorized" status.
    //    NB: the target repo/org is not known yet at this step in some flows —
    //    the frontend will send us the target during the /connect call. But
    //    if you initiated OAuth from a preview, you already know the target;
    //    we choose to keep OAuth and "connect" separate so a single OAuth
    //    grant can serve multiple repos in the same org (fewer redirects
    //    for the user).
    const integrationId = randomUUID();
    await this.integrations.create({
      id: integrationId,
      ownerUserId: input.userId,
      platform: input.platform,
      // These placeholders get replaced by the /connect call once the user
      // confirms the exact target. We could split into a "grants" table to
      // avoid the placeholders — deferred for simplicity.
      targetKind: "repository",
      targetOwner: identity.login,
      targetRepo: null,
      externalUserId: identity.externalUserId,
      externalUserLogin: identity.login,
      webhookExternalId: null,
      webhookSecretCiphertext: null,
      status: "authorized",
      lastError: null,
    });

    // 5. Persist encrypted tokens.
    await this.tokens.save({
      integrationId,
      platform: input.platform,
      ciphertext: this.encryptor.encrypt(tokens.accessToken),
      refreshCiphertext: tokens.refreshToken
        ? this.encryptor.encrypt(tokens.refreshToken)
        : null,
      scope: tokens.scope,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
    });

    return {
      integrationId,
      externalUserLogin: identity.login,
      returnTo: payload.returnTo,
    };
  }
}
