import { AppError } from "../errors/AppError";

export type SupportedProvider = "github" | "gitlab";

export interface ParsedRepositoryUrl {
    provider: SupportedProvider;
    owner: string;
    repository: string;
}

export class RepositoryUrlParser {
    public static parse(url: string): ParsedRepositoryUrl {
        if (!url || typeof url !== "string") {
            throw new AppError("Repository URL must be a valid string.", 400);
        }

        const normalizedUrl = url.trim().replace(/\/+$/u, "");
        const githubMatch = normalizedUrl.match(/^https?:\/\/(?:www\.)?github\.com\/([^\/]+?)\/([^\/]+?)(?:\.git)?$/iu);
        if (githubMatch) {
            return {
                provider: "github",
                owner: githubMatch[1],
                repository: githubMatch[2]
            };
        }

        const gitlabMatch = normalizedUrl.match(/^https?:\/\/(?:www\.)?gitlab\.com\/(.+?)(?:\.git)?$/iu);
        if (gitlabMatch) {
            const path = gitlabMatch[1].replace(/\/+$/u, "");
            const segments = path.split("/");
            if (segments.length < 2) {
                throw new AppError("Invalid GitLab repository URL.", 400);
            }

            const repository = segments.pop()!;
            const owner = segments.join("/");

            return {
                provider: "gitlab",
                owner,
                repository
            };
        }

        throw new AppError("Unsupported repository provider or invalid URL.", 400);
    }
}
