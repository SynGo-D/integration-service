/**
 * Domain error taxonomy.
 * -----------------------------------------------------------------------------
 * We use typed error classes instead of plain `throw new Error("bad url")`
 * strings so the HTTP layer can translate them into meaningful status codes
 * without every route sprinkling `if (err.message.includes("..."))` checks.
 *
 * Every error carries a stable `code` — useful for the front end (i18n keys,
 * user-facing messaging) and for log searches.
 *
 * SOLID: Open/Closed. Adding a new failure mode = adding a new subclass. The
 * mapping in `errorToHttp()` (routes layer) extends without touching existing
 * cases.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidUrlError extends DomainError {
  readonly code = "invalid_repository_url";
  readonly httpStatus = 400;
}

export class UnsupportedPlatformError extends DomainError {
  readonly code = "unsupported_platform";
  readonly httpStatus = 400;
}

export class PreviewFetchFailedError extends DomainError {
  readonly code = "preview_fetch_failed";
  readonly httpStatus = 502;
}

export class OAuthStateInvalidError extends DomainError {
  readonly code = "oauth_state_invalid";
  readonly httpStatus = 400;
}

export class OAuthExchangeFailedError extends DomainError {
  readonly code = "oauth_exchange_failed";
  readonly httpStatus = 502;
}

export class WebhookSignatureInvalidError extends DomainError {
  readonly code = "webhook_signature_invalid";
  readonly httpStatus = 401;
}

export class WebhookRegistrationFailedError extends DomainError {
  readonly code = "webhook_registration_failed";
  readonly httpStatus = 502;
}

export class IntegrationNotFoundError extends DomainError {
  readonly code = "integration_not_found";
  readonly httpStatus = 404;
}

export class InternalAuthFailedError extends DomainError {
  readonly code = "internal_auth_failed";
  readonly httpStatus = 401;
}
