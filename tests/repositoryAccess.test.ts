import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { IntegrationService } from "../src/services/IntegrationService.js";
import type { OrganizationRole } from "../src/models/Organization.js";

/**
 * Who may see a repository's data, and in what role.
 *
 * This existed as a hole rather than a rule: every repository route took
 * owner/repo from the URL and fetched, so any signed-in account — including
 * one belonging to no organization at all — could read another tenant's
 * analyses, AI reviews with their quoted source, business rules and spend,
 * and could edit or delete their rules. These tests are the rule.
 *
 * The answer is a list of roles rather than a yes or a no, because the
 * gateway has to decide more than whether to show the repository: a
 * developer may edit its business rules and a manager may not.
 */
const MEMBER = "member-user";
const OUTSIDER = "outsider-user";

function serviceWhere(roles: OrganizationRole[]) {
    const integrationRepository = {
        repositoryRolesFor: vi.fn(async (userId: string) => (userId === MEMBER ? roles : [])),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { integrationRepository, service: new IntegrationService(integrationRepository as any) };
}

describe("repository access", () => {
    let harness: ReturnType<typeof serviceWhere>;

    beforeEach(() => {
        harness = serviceWhere(["DEVELOPER"]);
    });

    it("lets a member of the owning organization through, with their role", async () => {
        await expect(
            harness.service.repositoryRolesFor(MEMBER, "github", "acme", "shop")
        ).resolves.toEqual(["DEVELOPER"]);
    });

    it("refuses someone who is signed in but belongs to no organization with it", async () => {
        await expect(
            harness.service.repositoryRolesFor(OUTSIDER, "github", "acme", "shop")
        ).resolves.toEqual([]);
    });

    it("refuses an empty user without asking the database", async () => {
        // A missing session must never reach a query that could match a row.
        await expect(
            harness.service.repositoryRolesFor("", "github", "acme", "shop")
        ).resolves.toEqual([]);

        expect(harness.integrationRepository.repositoryRolesFor).not.toHaveBeenCalled();
    });

    it("refuses when the repository is not named", async () => {
        await expect(harness.service.repositoryRolesFor(MEMBER, "github", "", "shop")).resolves.toEqual([]);
        await expect(harness.service.repositoryRolesFor(MEMBER, "github", "acme", "")).resolves.toEqual([]);

        expect(harness.integrationRepository.repositoryRolesFor).not.toHaveBeenCalled();
    });

    it("asks about exactly the repository that was requested", async () => {
        await harness.service.repositoryRolesFor(MEMBER, "github", "acme", "shop");

        expect(harness.integrationRepository.repositoryRolesFor)
            .toHaveBeenCalledWith(MEMBER, "github", "acme", "shop");
    });

    it("carries every role, for somebody in two organizations that both connected it", async () => {
        // Refusing a capability that one of their memberships grants would
        // be wrong, so the gateway is given both and decides from the pair.
        harness = serviceWhere(["MANAGER", "DEVELOPER"]);

        await expect(
            harness.service.repositoryRolesFor(MEMBER, "github", "acme", "shop")
        ).resolves.toEqual(["MANAGER", "DEVELOPER"]);
    });
});
