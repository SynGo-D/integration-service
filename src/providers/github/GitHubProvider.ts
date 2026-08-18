/**
 * GitHubProvider
 * -----------------------------------------------------------------------------
 * Implements IScmProvider against the GitHub REST API v3.
 *
 * SOLID:
 *   - S (SRP): everything GitHub-specific lives here. If GitHub renames a
 *     field, only this file changes.
 *   - L (LSP): produces the same normalized shapes (RepositoryPreview,
 *     OAuthTokens, WebhookRegistration) as GitLabProvider, so callers cannot
 *     tell them apart.
 *   - D (DIP): the class receives its dependencies (client id/secret, base
 *     URL, fetch impl) through the constructor. No process.env peeking here.
 *
 * OAuth scopes we request:
 *   - `repo`               : read/write repo contents & metadata (needed for
 *                            source-code access + commit history, FR-02.3).
 *                            NOTE: on public repos you could use `public_repo`
 *                            only, but the spec asks for private code review
 *                            too, so `repo` is the minimum that satisfies BOTH.
 *   - `read:org`           : list org repos on the org preview screen.
 *   - `admin:repo_hook`    : create/manage webhooks (FR-02.3).
 *   - `read:user`, `user:email`: fetch identity for record-keeping (FR-02.4).
 *
 * We deliberately do NOT request `delete_repo`, `workflow`, `write:packages`,
 * or any admin scope — that would violate the "minimum permissions required"
 * clause of FR-02.3.
 */

import { randomUUID } from "node:crypto";
import type {
  IScmProvider,
  ScmTarget,
  RepositoryPreview,
  OAuthAuthorizationRequest,
  OAuthTokens,
  WebhookRegistration,
} from "../../domain/interfaces/IScmProvider.js";
import {
  InvalidUrlError,
  OAuthExchangeFailedError,
  PreviewFetchFailedError,
  WebhookRegistrationFailedError,
} from "../../domain/errors/index.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_WEB = "https://github.com";

export interface GitHubProviderConfig {
  clientId: string;
  clientSecret: string;
  /** For GitHub Enterprise Server, override these two. Defaults hit github.com. */
  apiBaseUrl?: string;
  webBaseUrl?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** User-Agent GitHub requires on every request. */
  userAgent?: string;
}

const REQUIRED_SCOPES = ["repo", "read:org", "admin:repo_hook", "read:user", "user:email"];

export class GitHubProvider implements IScmProvider {
  readonly platform = "github" as const;
  private readonly api: string;
  private readonly web: string;
  private readonly fetch: typeof fetch;
  private readonly userAgent: string;

  constructor(private readonly cfg: GitHubProviderConfig) {
    this.api = cfg.apiBaseUrl ?? GITHUB_API;
    this.web = cfg.webBaseUrl ?? GITHUB_WEB;
    this.fetch = cfg.fetchImpl ?? fetch;
    this.userAgent = cfg.userAgent ?? "codepulse-integration/1.0";
  }

  // --------- IRepositoryReader --------------------------------------------

  parseTarget(url: string): ScmTarget {
    let u: URL;
    try {
      u = new URL(url.trim());
    } catch {
      throw new InvalidUrlError("Not a valid URL");
    }
    // Accept github.com and *.github.com (enterprise) & our overridden web URL.
    const webHost = new URL(this.web).host;
    if (u.host !== webHost && !u.host.endsWith(`.${webHost}`)) {
      throw new InvalidUrlError(`Not a ${webHost} URL`);
    }
    // Strip .git suffix, leading/trailing slashes, then split.
    const parts = u.pathname.replace(/\.git\/?$/i, "").replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length === 0 || !parts[0]) {
      throw new InvalidUrlError("URL is missing an owner");
    }
    if (parts.length === 1) {
      return {
        platform: "github",
        kind: "organization",
        owner: parts[0],
        hostBaseUrl: this.web,
      };
    }
    return {
      platform: "github",
      kind: "repository",
      owner: parts[0],
      repo: parts[1],
      hostBaseUrl: this.web,
    };
  }

  async fetchPreview(target: ScmTarget): Promise<RepositoryPreview> {
    try {
      if (target.kind === "repository") {
        return await this.fetchRepoPreview(target);
      }
      return await this.fetchOrgPreview(target);
    } catch (err) {
      // FR-02.4: if public metadata is unavailable, return degraded preview
      // — do NOT throw. The user still needs to see what will be connected.
      return { target, degraded: true };
    }
  }

  private async fetchRepoPreview(target: ScmTarget): Promise<RepositoryPreview> {
    const repoRes = await this.fetch(`${this.api}/repos/${target.owner}/${target.repo}`, {
      headers: this.headers(),
    });
    if (!repoRes.ok) {
      // 404 for private repos when unauthenticated → degraded (FR-02.4).
      if (repoRes.status === 404 || repoRes.status === 403) {
        return { target, degraded: true };
      }
      throw new PreviewFetchFailedError(`GitHub returned ${repoRes.status}`);
    }
    const repo = (await repoRes.json()) as GitHubRepo;

    // Languages & contributors are best-effort — if either fails we still
    // return the core preview.
    const [languages, contributors] = await Promise.allSettled([
      this.fetch(`${this.api}/repos/${target.owner}/${target.repo}/languages`, {
        headers: this.headers(),
      }).then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : {})),
      this.fetch(
        `${this.api}/repos/${target.owner}/${target.repo}/contributors?per_page=1&anon=1`,
        { headers: this.headers() },
      ).then((r) => {
        // Contributor count comes from the `Link` header's `last` page.
        const link = r.headers.get("link") ?? "";
        const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
        return m ? Number(m[1]) : null;
      }),
    ]);

    return {
      target,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      primaryLanguage: repo.language ?? null,
      languages:
        languages.status === "fulfilled" ? Object.keys(languages.value) : undefined,
      contributorsCount:
        contributors.status === "fulfilled" ? contributors.value : null,
      lastUpdatedAt: repo.updated_at,
      isPrivate: repo.private,
      ownerAvatarUrl: repo.owner?.avatar_url,
      degraded: false,
    };
  }

  private async fetchOrgPreview(target: ScmTarget): Promise<RepositoryPreview> {
    const [orgRes, reposRes] = await Promise.all([
      this.fetch(`${this.api}/orgs/${target.owner}`, { headers: this.headers() }),
      this.fetch(`${this.api}/orgs/${target.owner}/repos?per_page=5&sort=updated`, {
        headers: this.headers(),
      }),
    ]);
    if (!orgRes.ok) {
      // Fallback: maybe it's a user, not an org.
      const userRes = await this.fetch(`${this.api}/users/${target.owner}`, {
        headers: this.headers(),
      });
      if (!userRes.ok) return { target, degraded: true };
      const user = (await userRes.json()) as GitHubUser;
      return {
        target,
        name: user.login,
        description: user.bio ?? null,
        ownerAvatarUrl: user.avatar_url,
        degraded: false,
      };
    }
    const org = (await orgRes.json()) as GitHubOrg;
    const repos: GitHubRepo[] = reposRes.ok ? await reposRes.json() : [];
    return {
      target,
      name: org.name ?? org.login,
      description: org.description ?? null,
      ownerAvatarUrl: org.avatar_url,
      repositoryListSample: repos.map((r) => ({ name: r.name, fullName: r.full_name })),
      degraded: false,
    };
  }

  // --------- IOAuthProvider -----------------------------------------------

  buildAuthorizationUrl(state: string, redirectUri: string): OAuthAuthorizationRequest {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: redirectUri,
      scope: REQUIRED_SCOPES.join(" "),
      state,
      allow_signup: "false",
    });
    return {
      authorizationUrl: `${this.web}/login/oauth/authorize?${params.toString()}`,
      state,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens> {
    const res = await this.fetch(`${this.web}/login/oauth/access_token`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) throw new OAuthExchangeFailedError(`GitHub returned ${res.status}`);
    const payload = (await res.json()) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!payload.access_token) {
      throw new OAuthExchangeFailedError(
        payload.error_description ?? payload.error ?? "no access_token in response",
      );
    }
    return {
      accessToken: payload.access_token,
      tokenType: payload.token_type ?? "bearer",
      scope: payload.scope ?? "",
    };
  }

  async fetchAuthenticatedUser(accessToken: string) {
    const res = await this.fetch(`${this.api}/user`, {
      headers: { ...this.headers(), Authorization: `token ${accessToken}` },
    });
    if (!res.ok) throw new OAuthExchangeFailedError(`GitHub /user returned ${res.status}`);
    const u = (await res.json()) as GitHubUser & { id: number };
    return { externalUserId: String(u.id), login: u.login, email: u.email ?? null };
  }

  // --------- IWebhookRegistrar --------------------------------------------

  async registerWebhook(args: {
    accessToken: string;
    target: ScmTarget;
    deliveryUrl: string;
    secret: string;
    events: string[];
  }): Promise<WebhookRegistration> {
    if (args.target.kind !== "repository") {
      // Organization webhooks require a different endpoint & scopes; for
      // brevity we support repository hooks first (extend later without
      // breaking existing calls — OCP).
      throw new WebhookRegistrationFailedError(
        "Organization-level webhooks not implemented yet",
      );
    }
    const url = `${this.api}/repos/${args.target.owner}/${args.target.repo}/hooks`;

    // Idempotency: check for an existing hook with the same delivery URL.
    const existingRes = await this.fetch(url, {
      headers: { ...this.headers(), Authorization: `token ${args.accessToken}` },
    });
    if (existingRes.ok) {
      const hooks = (await existingRes.json()) as GitHubHook[];
      const dup = hooks.find((h) => h.config?.url === args.deliveryUrl);
      if (dup) {
        // Update secret + events on the existing hook rather than duplicate.
        const patchRes = await this.fetch(`${url}/${dup.id}`, {
          method: "PATCH",
          headers: {
            ...this.headers(),
            Authorization: `token ${args.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            config: {
              url: args.deliveryUrl,
              content_type: "json",
              secret: args.secret,
              insecure_ssl: "0",
            },
            events: args.events,
            active: true,
          }),
        });
        if (!patchRes.ok) {
          throw new WebhookRegistrationFailedError(`PATCH hook returned ${patchRes.status}`);
        }
        return {
          externalId: String(dup.id),
          secret: args.secret,
          events: args.events,
          createdAt: new Date().toISOString(),
        };
      }
    }

    const createRes = await this.fetch(url, {
      method: "POST",
      headers: {
        ...this.headers(),
        Authorization: `token ${args.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: args.events,
        config: {
          url: args.deliveryUrl,
          content_type: "json",
          secret: args.secret,
          insecure_ssl: "0",
        },
      }),
    });
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      throw new WebhookRegistrationFailedError(
        `POST hook returned ${createRes.status}: ${body.slice(0, 200)}`,
      );
    }
    const hook = (await createRes.json()) as GitHubHook;
    return {
      externalId: String(hook.id ?? randomUUID()),
      secret: args.secret,
      events: args.events,
      createdAt: hook.created_at ?? new Date().toISOString(),
    };
  }

  // --------- helpers -------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      "user-agent": this.userAgent,
      "x-github-api-version": "2022-11-28",
    };
  }
}

// ------------- Minimal typings for the pieces of GitHub responses we touch --

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  updated_at: string;
  private: boolean;
  owner?: { avatar_url?: string };
}

interface GitHubOrg {
  login: string;
  name?: string;
  description?: string | null;
  avatar_url?: string;
}

interface GitHubUser {
  login: string;
  bio?: string | null;
  avatar_url?: string;
  email?: string | null;
}

interface GitHubHook {
  id?: number;
  created_at?: string;
  config?: { url?: string };
}
