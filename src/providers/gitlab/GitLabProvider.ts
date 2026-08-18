/**
 * GitLabProvider
 * -----------------------------------------------------------------------------
 * Same contract as GitHubProvider (they both implement IScmProvider), but
 * targets the GitLab v4 REST API. Kept in a separate file so that platform
 * quirks (URL-encoded project paths, `access_token=` query param instead of
 * `Authorization: token`, `hooks` endpoint shape, …) stay isolated.
 *
 * OAuth scopes we request:
 *   - `read_api`, `read_repository`  : source code + metadata + MRs.
 *   - `api`                           : create/manage webhooks. GitLab does
 *     NOT expose a dedicated webhook scope — `api` is the minimum superset
 *     that permits POST /projects/:id/hooks. (Documented at
 *     https://docs.gitlab.com/user/profile/personal_access_tokens/#scopes-for-a-personal-access-token .)
 *   - `read_user`                     : identify who authorised.
 *
 * We do NOT request `sudo`, `admin_mode`, or `write_repository` — that goes
 * beyond what "minimum required" (FR-02.3) allows.
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

const GITLAB_HOST = "https://gitlab.com";
const REQUIRED_SCOPES = ["api", "read_api", "read_repository", "read_user"];

export interface GitLabProviderConfig {
  clientId: string;
  clientSecret: string;
  /** For self-hosted GitLab, override this. */
  hostUrl?: string;
  fetchImpl?: typeof fetch;
}

export class GitLabProvider implements IScmProvider {
  readonly platform = "gitlab" as const;
  private readonly host: string;
  private readonly api: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly cfg: GitLabProviderConfig) {
    this.host = cfg.hostUrl ?? GITLAB_HOST;
    this.api = `${this.host}/api/v4`;
    this.fetch = cfg.fetchImpl ?? fetch;
  }

  // --------- IRepositoryReader --------------------------------------------

  parseTarget(url: string): ScmTarget {
    let u: URL;
    try {
      u = new URL(url.trim());
    } catch {
      throw new InvalidUrlError("Not a valid URL");
    }
    const webHost = new URL(this.host).host;
    if (u.host !== webHost) throw new InvalidUrlError(`Not a ${webHost} URL`);

    // GitLab supports nested groups: gitlab.com/group/subgroup/project.git
    // Path is the project's URL-encoded path with namespace.
    const cleaned = u.pathname.replace(/\.git\/?$/i, "").replace(/^\/+|\/+$/g, "");
    if (!cleaned) throw new InvalidUrlError("URL is missing an owner");

    const segments = cleaned.split("/");
    if (segments.length === 1) {
      return {
        platform: "gitlab",
        kind: "organization", // = group in GitLab-speak
        owner: segments[0],
        hostBaseUrl: this.host,
      };
    }
    // Everything except the last segment is the group/namespace path.
    const owner = segments.slice(0, -1).join("/");
    const repo = segments[segments.length - 1];
    return {
      platform: "gitlab",
      kind: "repository",
      owner,
      repo,
      hostBaseUrl: this.host,
    };
  }

  async fetchPreview(target: ScmTarget): Promise<RepositoryPreview> {
    try {
      if (target.kind === "repository") return await this.fetchProjectPreview(target);
      return await this.fetchGroupPreview(target);
    } catch {
      return { target, degraded: true };
    }
  }

  private async fetchProjectPreview(target: ScmTarget): Promise<RepositoryPreview> {
    // GitLab expects the whole namespace+project path URL-encoded as one id.
    const pathEncoded = encodeURIComponent(`${target.owner}/${target.repo}`);
    const projectRes = await this.fetch(`${this.api}/projects/${pathEncoded}`);
    if (!projectRes.ok) {
      if (projectRes.status === 404 || projectRes.status === 401) {
        return { target, degraded: true };
      }
      throw new PreviewFetchFailedError(`GitLab returned ${projectRes.status}`);
    }
    const project = (await projectRes.json()) as GitLabProject;
    const [langs, members] = await Promise.allSettled([
      this.fetch(`${this.api}/projects/${pathEncoded}/languages`).then((r) =>
        r.ok ? (r.json() as Promise<Record<string, number>>) : {},
      ),
      // "contributors" on GitLab is via /repository/contributors; not paginated
      // consistently, so we use the length. Fine for a preview.
      this.fetch(`${this.api}/projects/${pathEncoded}/repository/contributors?per_page=100`).then(
        async (r) => (r.ok ? ((await r.json()) as unknown[]).length : null),
      ),
    ]);
    return {
      target,
      name: project.name,
      fullName: project.path_with_namespace,
      description: project.description,
      primaryLanguage:
        langs.status === "fulfilled"
          ? (Object.entries(langs.value as Record<string, number>).sort(
              (a, b) => b[1] - a[1],
            )[0]?.[0] ?? null)
          : null,
      languages:
        langs.status === "fulfilled"
          ? Object.keys(langs.value as Record<string, number>)
          : undefined,
      contributorsCount: members.status === "fulfilled" ? members.value : null,
      lastUpdatedAt: project.last_activity_at,
      isPrivate: project.visibility !== "public",
      ownerAvatarUrl: project.avatar_url ?? undefined,
      degraded: false,
    };
  }

  private async fetchGroupPreview(target: ScmTarget): Promise<RepositoryPreview> {
    const groupRes = await this.fetch(
      `${this.api}/groups/${encodeURIComponent(target.owner)}`,
    );
    if (!groupRes.ok) return { target, degraded: true };
    const group = (await groupRes.json()) as GitLabGroup;
    const projectsRes = await this.fetch(
      `${this.api}/groups/${encodeURIComponent(target.owner)}/projects?per_page=5&order_by=last_activity_at`,
    );
    const projects: GitLabProject[] = projectsRes.ok ? await projectsRes.json() : [];
    return {
      target,
      name: group.name,
      description: group.description,
      ownerAvatarUrl: group.avatar_url,
      repositoryListSample: projects.map((p) => ({
        name: p.name,
        fullName: p.path_with_namespace,
      })),
      degraded: false,
    };
  }

  // --------- IOAuthProvider -----------------------------------------------

  buildAuthorizationUrl(state: string, redirectUri: string): OAuthAuthorizationRequest {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: REQUIRED_SCOPES.join(" "),
      state,
    });
    return {
      authorizationUrl: `${this.host}/oauth/authorize?${params.toString()}`,
      state,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens> {
    const res = await this.fetch(`${this.host}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) throw new OAuthExchangeFailedError(`GitLab returned ${res.status}`);
    const p = (await res.json()) as {
      access_token: string;
      token_type: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    return {
      accessToken: p.access_token,
      tokenType: p.token_type ?? "bearer",
      refreshToken: p.refresh_token,
      scope: p.scope ?? "",
      accessTokenExpiresAt: p.expires_in
        ? new Date(Date.now() + p.expires_in * 1000).toISOString()
        : undefined,
    };
  }

  async fetchAuthenticatedUser(accessToken: string) {
    const res = await this.fetch(`${this.api}/user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new OAuthExchangeFailedError(`GitLab /user returned ${res.status}`);
    const u = (await res.json()) as { id: number; username: string; email?: string };
    return { externalUserId: String(u.id), login: u.username, email: u.email ?? null };
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
      throw new WebhookRegistrationFailedError(
        "Group-level webhooks not implemented yet",
      );
    }
    const projectId = encodeURIComponent(`${args.target.owner}/${args.target.repo}`);
    const url = `${this.api}/projects/${projectId}/hooks`;
    const authHeaders = { Authorization: `Bearer ${args.accessToken}` };

    // GitLab's flag names differ; map our events onto them.
    const flags = this.eventFlagsFor(args.events);

    // Idempotency: look for existing hook with same URL.
    const listRes = await this.fetch(url, { headers: authHeaders });
    if (listRes.ok) {
      const hooks = (await listRes.json()) as GitLabHook[];
      const dup = hooks.find((h) => h.url === args.deliveryUrl);
      if (dup) {
        const putRes = await this.fetch(`${url}/${dup.id}`, {
          method: "PUT",
          headers: { ...authHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            url: args.deliveryUrl,
            token: args.secret,
            enable_ssl_verification: true,
            ...flags,
          }),
        });
        if (!putRes.ok) {
          throw new WebhookRegistrationFailedError(`PUT hook returned ${putRes.status}`);
        }
        return {
          externalId: String(dup.id),
          secret: args.secret,
          events: args.events,
          createdAt: new Date().toISOString(),
        };
      }
    }

    const postRes = await this.fetch(url, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        url: args.deliveryUrl,
        token: args.secret,
        enable_ssl_verification: true,
        ...flags,
      }),
    });
    if (!postRes.ok) {
      const body = await postRes.text().catch(() => "");
      throw new WebhookRegistrationFailedError(
        `POST hook returned ${postRes.status}: ${body.slice(0, 200)}`,
      );
    }
    const hook = (await postRes.json()) as GitLabHook;
    return {
      externalId: String(hook.id ?? randomUUID()),
      secret: args.secret,
      events: args.events,
      createdAt: hook.created_at ?? new Date().toISOString(),
    };
  }

  private eventFlagsFor(events: string[]): Record<string, boolean> {
    // Map normalized event names onto GitLab's boolean flags. Anything we
    // don't recognise is silently ignored, which is fine — adding new
    // events later means adding cases here without breaking callers (OCP).
    const flags: Record<string, boolean> = {};
    for (const e of events) {
      switch (e) {
        case "merge_request":
        case "pull_request":
          flags.merge_requests_events = true;
          break;
        case "push":
          flags.push_events = true;
          break;
        case "note":
        case "issue_comment":
          flags.note_events = true;
          break;
        case "pipeline":
          flags.pipeline_events = true;
          break;
      }
    }
    return flags;
  }
}

// -------------- Minimal typings for the pieces of GitLab responses we touch --

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string | null;
  last_activity_at: string;
  visibility: "public" | "internal" | "private";
  avatar_url: string | null;
}

interface GitLabGroup {
  id: number;
  name: string;
  description: string | null;
  avatar_url?: string;
}

interface GitLabHook {
  id?: number;
  url?: string;
  created_at?: string;
}
