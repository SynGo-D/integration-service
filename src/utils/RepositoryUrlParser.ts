// src/utils/RepositoryUrlParser.ts

import { AppError } from "../errors/AppError.js";

export type SupportedProvider = "github" | "gitlab";

export interface ParsedRepositoryUrl {
    provider:   SupportedProvider;
    owner:      string;
    repository: string;
}

/**
 * Parses GitHub and GitLab repository URLs into a structured form.
 *
 * Accepted formats:
 *   https://github.com/<owner>/<repo>
 *   https://github.com/<owner>/<repo>.git
 *   https://gitlab.com/<namespace>/<repo>
 *   https://gitlab.com/<namespace>/<repo>.git
 *   https://gitlab.com/<group>/<subgroup>/<repo>   (nested namespaces)
 *
 * The parser is intentionally strict: only plain HTTPS repository URLs are
 * accepted. SSH URLs and web page sub-paths (e.g. /issues) are rejected.
 *
 * This is a validation boundary, not a convenience helper — whatever it
 * returns becomes the owner/repo stored on the integration, used to register
 * the provider webhook, and handed to the analysis pipeline. Anything it
 * mis-parses becomes an integration pointing at a repository that does not
 * exist, and the failure surfaces much later as a confusing provider error.
 */
export class RepositoryUrlParser {

    /**
     * Strips the decorations a copied URL tends to carry.
     *
     * Order matters: trailing slashes come off *before* the `.git` suffix.
     * Doing it the other way round leaves `.git` attached on the very common
     * `https://github.com/acme/shop.git/` form, because the `$` anchor can't
     * match a `.git` that isn't at the end of the string.
     *
     * Exposed publicly so callers that need the canonical URL (see
     * IntegrationService.initiateOAuth) share this one implementation rather
     * than repeating — and re-introducing — the same ordering mistake.
     */
    public static normalize(url: string): string {
        return url.trim()
            .replace(/\/+$/u, "")
            .replace(/\.git$/u, "");
    }

    public static parse(url: string): ParsedRepositoryUrl {
        if (!url || typeof url !== "string") {
            throw new AppError("Repository URL must be a valid string.", 400);
        }

        const normalizedUrl = RepositoryUrlParser.normalize(url);

        // ---------------------------------------------------------------
        // GitHub: https://github.com/<owner>/<repo>
        // ---------------------------------------------------------------
        const githubMatch = normalizedUrl.match(
            /^https?:\/\/(?:www\.)?github\.com\/([^/]+?)\/([^/]+?)$/iu
        );
        if (githubMatch) {
            return {
                provider:   "github",
                owner:      githubMatch[1],
                repository: githubMatch[2]
            };
        }

        // ---------------------------------------------------------------
        // GitLab: https://gitlab.com/<namespace>[/<subgroups>]/<repo>
        // Requires at least two path segments (owner + repo).
        // ---------------------------------------------------------------
        const gitlabMatch = normalizedUrl.match(
            /^https?:\/\/(?:www\.)?gitlab\.com\/(.+?)$/iu
        );
        if (gitlabMatch) {
            const path     = gitlabMatch[1].replace(/\/+$/u, "");
            const segments = path.split("/");

            // GitLab separates a project's own pages from its path with a
            // literal `-` segment: /acme/shop/-/issues, /-/merge_requests/7,
            // /-/tree/main. Without this check the pattern below happily
            // treats the trailing segment as the repository name and folds
            // the rest into the namespace, so pasting an issue URL from the
            // browser silently produces owner="acme/shop/-", repo="issues" —
            // a valid-looking integration for a repository that isn't real.
            //
            // Unlike GitHub, the namespace here is variable-length (nested
            // subgroups are legitimate), so segment count alone can't
            // distinguish a sub-path; the `-` marker is what makes it
            // unambiguous.
            if (segments.includes("-")) {
                throw new AppError(
                    "Invalid GitLab repository URL: this looks like a project page " +
                    "(issues, merge requests, files) rather than the repository root.",
                    400
                );
            }

            if (segments.length < 2) {
                throw new AppError(
                    "Invalid GitLab repository URL: must include both a namespace and a repository name.",
                    400
                );
            }

            const repository = segments.pop()!;
            const owner      = segments.join("/"); // handles nested namespaces

            return {
                provider: "gitlab",
                owner,
                repository
            };
        }

        throw new AppError(
            "Unsupported repository URL. Please provide a valid GitHub or GitLab repository URL.",
            400
        );
    }
}
