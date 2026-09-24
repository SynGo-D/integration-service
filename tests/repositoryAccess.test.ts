import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { IntegrationService } from "../src/services/IntegrationService.js";

/**
 * Who may see a repository's data.
 *
 * This existed as a hole rather than a rule: every repository route took
 * owner/repo from the URL and fetched, so any signed-in account — including
 * one belonging to no organization at all — could read another tenant's
 * analyses, AI reviews with their quoted source, business rules and spend,
 * and could edit or delete their rules. These tests are the rule.
 */
const MEMBER = "member-user";
const OUTSIDER = "outsider-user";

function serviceWhere(allowed: boolean) {
    const integrationRepository = {
        userCanAccessRepository: vi.fn(async (userId: string) => allowed && userId === MEMBER),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { integrationRepository, service: new IntegrationService(integrationRepository as any) };
}

describe("repository access", () => {
    let harness: ReturnType<typeof serviceWhere>;

    beforeEach(() => {
        harness = serviceWhere(true);
    });

    it("lets a member of the owning organization through", async () => {
        await expect(
            harness.service.userCanAccessRepository(MEMBER, "github", "acme", "shop")
        ).resolves.toBe(true);
    });

    it("refuses someone who is signed in but belongs to no organization with it", async () => {
        await expect(
            harness.service.userCanAccessRepository(OUTSIDER, "github", "acme", "shop")
        ).resolves.toBe(false);
    });

    it("refuses an empty user without asking the database", async () => {
        // A missing session must never reach a query that could match a row.
        await expect(
            harness.service.userCanAccessRepository("", "github", "acme", "shop")
        ).resolves.toBe(false);

        expect(harness.integrationRepository.userCanAccessRepository).not.toHaveBeenCalled();
    });

    it("refuses when the repository is not named", async () => {
        await expect(harness.service.userCanAccessRepository(MEMBER, "github", "", "shop")).resolves.toBe(false);
        await expect(harness.service.userCanAccessRepository(MEMBER, "github", "acme", "")).resolves.toBe(false);

        expect(harness.integrationRepository.userCanAccessRepository).not.toHaveBeenCalled();
    });

    it("asks about exactly the repository that was requested", async () => {
        await harness.service.userCanAccessRepository(MEMBER, "github", "acme", "shop");

        expect(harness.integrationRepository.userCanAccessRepository)
            .toHaveBeenCalledWith(MEMBER, "github", "acme", "shop");
    });
});
