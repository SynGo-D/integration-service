# Integration Service

Repository-connection microservice for the CodePulse automated code-review
platform. Owns everything to do with linking a user's GitHub/GitLab
repository to the platform: previewing it, running the OAuth flow, storing
the resulting access token, and registering the webhook that makes
analysis happen.

**This service never analyzes code and never receives webhooks.** It
*registers* the webhook; deliveries go to `webhook-listener`.

> **Interop note:** `main-backend` is the only thing that calls this
> service, server-to-server — browsers never reach it directly. The one
> exception is the OAuth callback, which the provider redirects the user's
> *browser* to. That asymmetry shapes the rate limiting (see below), so
> keep it in mind before exposing any route publicly.

## Where it sits

```text
   user pastes a repo URL
            │
            ▼
   ┌──────────────────┐        ┌──────────────────────┐
   │   web-interface  │───────▶│     main-backend     │
   └──────────────────┘        └──────────┬───────────┘
                                           │ server-to-server
                                           ▼
                              ┌─────────────────────────┐
                              │   integration-service   │
                              └────┬───────────────┬────┘
                                   │               │
                      OAuth + repo │               │ creates webhook
                          metadata │               │
                                   ▼               ▼
                            GitHub / GitLab ──▶ webhook-listener
                                                (PR events)
```

## The flow

| Step | Endpoint | What happens |
|---|---|---|
| **1. Preview** | `GET /api/repositories/preview?url=` | Parse the URL, fetch public metadata. No auth — same data anyone could see. Lets the user confirm the repo before being sent to a login screen. |
| **2. Authorize** | `POST /api/integrations/authorize` | Create a `PENDING` row (with a CSRF nonce), return the provider's authorization URL. The row exists *before* the redirect so the callback can be correlated back to a repository. |
| **3. Callback** | `GET /api/integrations/:provider/oauth/callback` | Verify + consume the nonce, exchange the code for a token, encrypt and store it, flip to `ACTIVE`, register the webhook, redirect to the frontend. |
| **4. Manage** | `GET`/`DELETE /api/integrations` | List, fetch, revoke. Revoking also removes the provider-side webhook. |

Integration lifecycle: `PENDING → ACTIVE → REVOKED` (plus `EXPIRED`, which
nothing sets yet — see Known gaps).

## Layers

| Layer | Responsibility |
|---|---|
| `routes/` | URL → controller. Rate limiters attach here |
| `controllers/` | HTTP only — parse, delegate, shape the response, strip secrets |
| `services/` | All business rules: duplicate prevention, OAuth orchestration, webhook registration |
| `adapters/` | Provider-specific API calls (Adapter Pattern) — the only files that know GitHub from GitLab |
| `factories/` | `ProviderFactory.create(provider)` → the right adapter |
| `repositories/` | The only place SQL lives (Repository Pattern) |
| `utils/` | `crypto.ts` (AES-256-GCM), `RepositoryUrlParser.ts` |
| `middleware/` | Rate limiting, validation, error handling |

Adding a provider means implementing `ProviderAdapter` and adding one case
to `ProviderFactory`. No service or controller code changes.

## Security

**Tokens are encrypted at rest** with AES-256-GCM (`utils/crypto.ts`).
GCM is authenticated encryption, so a tampered ciphertext fails to decrypt
rather than silently yielding garbage. A fresh random IV per encryption
means the same token never produces the same ciphertext twice. Tokens are
stripped from API responses by an allowlist in
`IntegrationController.sanitize`.

**The OAuth flow is CSRF-protected** by a nonce stored on the `PENDING`
row and verified in `IntegrationRepository.consumeOAuthNonce`, which locks
the row, compares in constant time, and clears the nonce in the same
transaction. That makes it single-use: a replayed callback fails.
Authorization sessions expire after 10 minutes.

**Rate limiting is keyed by identity, not just IP** — because almost all
traffic arrives from `main-backend`'s single IP, a naive per-IP limit
would let one user lock out everyone. `/authorize` is keyed by `userId`,
the OAuth callback by real client IP. See `middleware/rateLimit.ts`.

> **Deployment requirement:** `userId`-based limiting assumes only
> `main-backend` and provider redirects can reach this service. Enforce
> that at the network layer — if port 5001 is publicly reachable, a caller
> can pass any `userId`.

## Local development

Requires Node.js and a PostgreSQL database.

```bash
# 1. Install dependencies
npm install

# 2. Copy env config and fill in your own OAuth credentials
cp .env.example .env

# 3. Generate an encryption key (32 bytes, hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Run migrations
npm run migrate:up

# 5. Start the service
npm run dev
```

```bash
curl http://localhost:5001/health
```

> **Do not commit `.env`.** It is listed in `.gitignore`, but was tracked
> before that rule existed — check `git ls-files .env` before assuming
> it's safe.

### Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 5001) |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | PostgreSQL connection |
| `GITHUB_CLIENT_ID` `GITHUB_CLIENT_SECRET` `GITHUB_CALLBACK_URL` | GitHub OAuth app |
| `GITLAB_CLIENT_ID` `GITLAB_CLIENT_SECRET` `GITLAB_CALLBACK_URL` | GitLab OAuth app |
| `ENCRYPTION_KEY` | 32-byte hex key for token encryption |
| `FRONTEND_ORIGIN` `FRONTEND_SUCCESS_URL` `FRONTEND_ERROR_URL` | CORS + post-OAuth redirects |
| `WEBHOOK_LISTENER_URL` | Where registered webhooks deliver to |
| `GITHUB_WEBHOOK_SECRET` `GITLAB_WEBHOOK_SECRET` | Must match `webhook-listener`'s values exactly |

## Tests

```bash
npm test
```

Vitest, no infrastructure required — no database, no network.

- `crypto.ts` — round-trip, IV randomness, tamper detection on the
  ciphertext, auth tag and IV
- `RepositoryUrlParser.ts` — valid forms, nested GitLab namespaces,
  sub-path and SSH rejection
- **Token refresh** — expiry margins, refresh-token rotation, and the
  `EXPIRED` transitions, driven with a stub provider and controlled
  clocks because the real path only fires hours after a live connection

The adapters' HTTP calls and the repositories' SQL are **not** covered
yet — they need HTTP and database mocking.

## Token lifecycle

Any provider call made with a *stored* token must go through
`IntegrationService.getValidAccessToken`, never `integration.accessToken`
directly. It returns the token unchanged when there's no expiry (classic
GitHub OAuth Apps) or when it's still comfortably valid, and otherwise
refreshes it — 60 seconds *before* expiry, so a token can't lapse
mid-request.

Both providers rotate refresh tokens, so the new one is persisted
alongside the new access token; keeping the old would break the following
refresh. If there's no refresh token, or the provider rejects it (user
revoked the grant, token already consumed), the integration is marked
`EXPIRED` and a 401 asks the user to reconnect — rather than the
connection looking healthy while every call fails.

This path is easy to miss in development: GitHub tokens don't expire by
default, so it never fires, while **GitLab tokens last two hours**.

## Known gaps

- **Preview calls GitHub unauthenticated**, which GitHub limits to 60
  requests/hour *per source IP* — a budget shared by every user, since
  they all leave from this server. `previewQuotaLimiter` rations it and
  fails with a clear message, but the real fix is to authenticate that
  call (raising the ceiling to 5,000/hour).
- **One webhook secret for all repositories.** If `GITHUB_WEBHOOK_SECRET`
  leaks, deliveries can be forged for every connected repo. Per-integration
  secrets would contain the blast radius.
- **`IntegrationController.ts:155`** has a type error (`req.query.state`
  is `string | string[]`); `npm run build` does not currently pass.
- Only `integrations` and `users` tables remain — the unused Phase 0
  multi-repository schema was dropped in migration 005.
