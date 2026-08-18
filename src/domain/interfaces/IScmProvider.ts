/**
 * IScmProvider
 * -----------------------------------------------------------------------------
 * The single abstraction the rest of the service depends on to talk to a
 * Source Control Management platform (GitHub, GitLab, and — in future —
 * Bitbucket, Azure DevOps, Gitea, …).
 *
 * SOLID application:
 *  - D (Dependency Inversion): higher-level services (OAuthOrchestrator,
 *    RepositoryPreviewService, WebhookIngressService) depend on THIS
 *    interface, not on GitHub- or GitLab-specific classes.
 *  - O (Open/Closed): adding Bitbucket = adding a new class that implements
 *    this interface + registering it in ProviderFactory. NO existing code
 *    changes.
 *  - L (Liskov Substitution): any implementation must be swappable —
 *    that is why the return shapes are normalised (RepositoryPreview,
 *    NormalizedWebhookEvent) rather than raw GitHub/GitLab payloads.
 *
 * Note: this interface is intentionally kept small. We segregate different
 * capabilities into narrower interfaces below (Interface Segregation
 * Principle) so a component that only reads repos never has to know about
 * OAuth or webhooks.
 */

// ---------- Value objects (platform-neutral) ---------------------------------

export type ScmPlatform = "github" | "gitlab";

/**
 * Parsed repository or organization identifier extracted from the URL the
 * user typed on the front end. This is what FR-02.4 refers to when it says
 * "if public metadata is unavailable, extract available repository info from
 * the provided URL". We can always at least get this much.
 */
export interface ScmTarget {
  platform: ScmPlatform;
  kind: "repository" | "organization";
  owner: string;               // github user/org name, or gitlab group path
  repo?: string;               // undefined for organizations
  hostBaseUrl: string;         // e.g. "https://github.com" or a self-hosted gitlab
}

/**
 * Public metadata we display BEFORE the user authorises the OAuth grant
 * (FR-02.2, FR-02.3, FR-02.5).
 *
 * Every field is optional except `target` because we might be looking at a
 * private repository where the public API returns nothing useful — in that
 * case we still want to show the user WHAT we would connect to (owner+repo).
 */
export interface RepositoryPreview {
  target: ScmTarget;
  name?: string;
  fullName?: string;                    // e.g. "octocat/hello-world"
  description?: string | null;
  primaryLanguage?: string | null;
  languages?: string[];                 // best-effort list, if the API exposes it
  contributorsCount?: number | null;    // may be missing on private / rate-limited responses
  lastUpdatedAt?: string | null;        // ISO-8601
  isPrivate?: boolean;
  ownerAvatarUrl?: string;
  repositoryListSample?: Array<{ name: string; fullName: string }>; // organizations only
  /**
   * When the API is unreachable / private, we still want the UI to know
   * "this is what we could figure out from the URL alone".
   */
  degraded: boolean;
}

/**
 * Represents the OAuth authorisation URL we send the user to (FR-02.6).
 * We produce this on the server so we can attach a signed `state` value
 * that ties the eventual callback to a specific user session.
 */
export interface OAuthAuthorizationRequest {
  authorizationUrl: string;
  state: string;              // opaque, signed on our side
  expiresAt: string;          // when the state token stops being valid
}

/**
 * Result of exchanging an OAuth `code` for an access token (FR-02.8).
 * Refresh token & expiry are optional because GitHub's default flow
 * gives you long-lived tokens with no refresh, while GitLab always
 * gives short-lived + refresh.
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;              // "bearer"
  scope: string;                  // comma- or space-separated scopes actually granted
  accessTokenExpiresAt?: string;  // ISO-8601
}

/**
 * Everything we need to persist a webhook registration.
 */
export interface WebhookRegistration {
  externalId: string;         // GitHub hook id or GitLab hook id
  secret: string;             // shared secret used to sign incoming events
  events: string[];           // normalized list, e.g. ["pull_request", "push"]
  createdAt: string;
}

// ---------- Segregated capability interfaces (ISP) ---------------------------

/**
 * Read-only capability: fetch public metadata. This is the ONLY capability
 * needed to satisfy FR-02.2 "before requesting authorization". Splitting it
 * out means the preview endpoint doesn't need OAuth credentials in scope.
 */
export interface IRepositoryReader {
  /**
   * Parse and validate the user-supplied URL. Throws InvalidUrlError if it
   * clearly isn't a repository/org URL for this provider.
   */
  parseTarget(url: string): ScmTarget;

  /**
   * Fetch what we can PUBLICLY (no OAuth token yet). If the target is
   * private or the API is unreachable, MUST return a degraded preview
   * (see RepositoryPreview.degraded) instead of throwing — because the
   * user still needs to see what they're about to connect (FR-02.4).
   */
  fetchPreview(target: ScmTarget): Promise<RepositoryPreview>;
}

/**
 * OAuth capability. Kept separate from IRepositoryReader (ISP): callers that
 * only render previews cannot accidentally trigger a token exchange.
 */
export interface IOAuthProvider {
  /**
   * Build the URL we redirect the user's browser to (FR-02.6). `state` is
   * a value we generated & signed elsewhere; the caller is responsible for
   * verifying it when the callback comes back.
   */
  buildAuthorizationUrl(state: string, redirectUri: string): OAuthAuthorizationRequest;

  /**
   * Exchange the `code` returned in the OAuth callback for tokens (FR-02.8).
   */
  exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens>;

  /**
   * Return the human-readable identity behind an access token, so we can
   * record WHICH github/gitlab account authorised the integration.
   */
  fetchAuthenticatedUser(accessToken: string): Promise<{
    externalUserId: string;
    login: string;
    email?: string | null;
  }>;
}

/**
 * Webhook management capability (FR-02.3 "webhook management",
 * FR-03.1 "expose a secure webhook endpoint"). Splitting this out means
 * the ingestion route doesn't need OAuth capabilities in scope, only the
 * verifier.
 */
export interface IWebhookRegistrar {
  /**
   * Register a webhook on the platform pointing back at our public
   * ingestion URL, using a fresh random `secret` we control. Returns the
   * registration record so we can persist it. Idempotent: if a hook with
   * the same URL already exists, MUST update it instead of duplicating.
   */
  registerWebhook(args: {
    accessToken: string;
    target: ScmTarget;
    deliveryUrl: string;
    secret: string;
    events: string[];
  }): Promise<WebhookRegistration>;
}

/**
 * Convenience aggregate — mostly used by the ProviderFactory to type the
 * fully-featured provider a service will typically want.
 */
export interface IScmProvider
  extends IRepositoryReader,
    IOAuthProvider,
    IWebhookRegistrar {
  readonly platform: ScmPlatform;
}
