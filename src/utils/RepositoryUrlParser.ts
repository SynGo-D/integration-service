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
 */
export class RepositoryUrlParser {

    public static parse(url: string): ParsedRepositoryUrl {
        if (!url || typeof url !== "string") {
            throw new AppError("Repository URL must be a valid string.", 400);
        }

        const normalizedUrl = url.trim()
            .replace(/\.git$/u, "")
            .replace(/\/+$/u, "");

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
