import { describe, it, expect } from "vitest";
import { RepositoryUrlParser } from "../src/utils/RepositoryUrlParser.js";

/**
 * This parser is a validation boundary, not a convenience helper: whatever it
 * returns becomes the owner/repo pair stored on the integration row, used to
 * register the provider webhook, and handed to the analysis pipeline. A URL
 * it mis-parses becomes an integration pointing at a repository that doesn't
 * exist.
 */
describe("RepositoryUrlParser.parse", () => {

    describe("GitHub", () => {
        it.each([
            ["https://github.com/acme/shop", "acme", "shop"],
            ["https://github.com/acme/shop.git", "acme", "shop"],
            ["https://github.com/acme/shop/", "acme", "shop"],
            ["https://github.com/acme/shop.git/", "acme", "shop"],
            ["http://github.com/acme/shop", "acme", "shop"],
            ["https://www.github.com/acme/shop", "acme", "shop"],
            ["  https://github.com/acme/shop  ", "acme", "shop"],
            ["https://GitHub.com/acme/shop", "acme", "shop"],
            ["https://github.com/acme/my.repo.name", "acme", "my.repo.name"],
            ["https://github.com/acme/repo-with-dashes", "acme", "repo-with-dashes"],
        ])("parses %s", (url, owner, repository) => {
            expect(RepositoryUrlParser.parse(url)).toEqual({
                provider: "github", owner, repository
            });
        });
    });

    describe("GitLab", () => {
        it.each([
            ["https://gitlab.com/acme/shop", "acme", "shop"],
            ["https://gitlab.com/acme/shop.git", "acme", "shop"],
            ["https://gitlab.com/acme/shop/", "acme", "shop"],
            ["https://gitlab.com/acme/shop.git/", "acme", "shop"],
            // Nested namespaces are a real GitLab feature — everything before
            // the final segment is the namespace.
            ["https://gitlab.com/group/subgroup/shop", "group/subgroup", "shop"],
            ["https://gitlab.com/a/b/c/shop", "a/b/c", "shop"],
        ])("parses %s", (url, owner, repository) => {
            expect(RepositoryUrlParser.parse(url)).toEqual({
                provider: "gitlab", owner, repository
            });
        });
    });

    describe("rejects URLs that are not repository roots", () => {
        it.each([
            // GitHub sub-paths — the `$`-anchored two-segment pattern covers these.
            ["https://github.com/acme/shop/issues"],
            ["https://github.com/acme/shop/pull/42"],
            ["https://github.com/acme/shop/tree/main/src"],
            // GitLab sub-paths. Modern GitLab puts every non-repository page
            // behind a `/-/` separator, which is exactly what makes these
            // distinguishable from a nested namespace.
            ["https://gitlab.com/acme/shop/-/issues"],
            ["https://gitlab.com/acme/shop/-/merge_requests/7"],
            ["https://gitlab.com/group/sub/shop/-/tree/main"],
        ])("rejects %s", (url) => {
            expect(() => RepositoryUrlParser.parse(url)).toThrow();
        });
    });

    describe("rejects unsupported input", () => {
        it.each([
            ["git@github.com:acme/shop.git", "SSH URL"],
            ["git@gitlab.com:acme/shop.git", "SSH URL"],
            ["https://bitbucket.org/acme/shop", "unsupported host"],
            ["https://example.com/acme/shop", "unsupported host"],
            ["https://github.com/acme", "owner with no repository"],
            ["https://gitlab.com/acme", "namespace with no repository"],
            ["https://github.com/", "no path"],
            ["not a url at all", "not a URL"],
            ["", "empty string"],
        ])("rejects %s (%s)", (url) => {
            expect(() => RepositoryUrlParser.parse(url)).toThrow();
        });

        it.each([
            [null],
            [undefined],
            [12345],
            [{}],
        ])("rejects non-string input: %s", (value) => {
            expect(() => RepositoryUrlParser.parse(value as unknown as string)).toThrow();
        });
    });

    it("never returns an owner or repository containing a path separator marker", () => {
        // Guards the class of bug where a sub-path is absorbed into the
        // namespace instead of being rejected.
        const url = "https://gitlab.com/group/subgroup/shop";
        const result = RepositoryUrlParser.parse(url);

        expect(result.repository).not.toContain("/");
        expect(result.owner.split("/")).not.toContain("-");
    });
});

describe("RepositoryUrlParser.normalize", () => {
    it.each([
        ["https://github.com/acme/shop.git", "https://github.com/acme/shop"],
        ["https://github.com/acme/shop/", "https://github.com/acme/shop"],
        // The order matters: stripping `.git` before the trailing slash
        // leaves `.git` behind on this input.
        ["https://github.com/acme/shop.git/", "https://github.com/acme/shop"],
        ["  https://github.com/acme/shop  ", "https://github.com/acme/shop"],
        ["https://github.com/acme/shop///", "https://github.com/acme/shop"],
    ])("normalizes %s", (input, expected) => {
        expect(RepositoryUrlParser.normalize(input)).toBe(expected);
    });
});
