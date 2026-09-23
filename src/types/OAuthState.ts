// src/types/OAuthState.ts

/**
 * Payload encoded into the OAuth "state" query parameter.
 *
 * The state is JSON-stringified then base64-encoded before being sent
 * to the provider, and decoded on the callback to restore context.
 *
 * Keeping state minimal reduces URL size and avoids leaking sensitive data.
 */
export interface OAuthState {

    /** Integration row ID created before redirecting to the provider. */
    integrationId: string;

    /**
     * Provider name — needed in the callback to choose the right adapter
     * without an extra DB lookup just to read the provider field.
     */
    provider: "github" | "gitlab";

    /** CSRF protection: a random nonce validated on callback. */
    nonce: string;
}
