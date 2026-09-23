import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { OrganizationService } from "../src/services/OrganizationService.js";
import type { OrganizationRole } from "../src/models/Organization.js";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const PROJECT = "33333333-3333-3333-3333-333333333333";

/** Roles by user id, so each test can say who is asking. */
function harness(roles: Record<string, OrganizationRole>, options: { admins?: number; project?: object | null } = {}) {
    const organizations = {
        roleOf: vi.fn(async (organizationId: string, userId: string) =>
            organizationId === ORG ? roles[userId] ?? null : null),
        adminCount: vi.fn(async () => options.admins ?? 2),
        addMember: vi.fn(async () => undefined),
        removeMember: vi.fn(async () => true),
        members: vi.fn(async () => []),
        findById: vi.fn(async () => ({ id: ORG, name: "Acme", slug: "acme" })),
        findForUser: vi.fn(async () => []),
        createWithOwner: vi.fn(async (name: string, slug: string) => ({ id: ORG, name, slug })),
        slugExists: vi.fn(async () => false),
    };
    const projects = {
        findById: vi.fn(async () =>
            options.project === undefined
                ? { id: PROJECT, organizationId: ORG, name: "Checkout" }
                : options.project),
        findForOrganization: vi.fn(async () => []),
        create: vi.fn(async (organizationId: string, name: string, slug: string) => ({ id: PROJECT, organizationId, name, slug })),
        update: vi.fn(async () => ({ id: PROJECT, organizationId: ORG, name: "Renamed" })),
        delete: vi.fn(async () => true),
        assignRepository: vi.fn(async () => true),
        slugExists: vi.fn(async () => false),
    };
    const users = {
        findByEmail: vi.fn(async () => null),
        create: vi.fn(async (email: string, fullName: string) => ({ id: "new-user", email, fullName })),
    };
    const service = new OrganizationService(organizations as never, projects as never, users as never);
    return { service, organizations, projects, users };
}

const ADMIN = "admin-user";
const MANAGER = "manager-user";
const DEVELOPER = "developer-user";
const OUTSIDER = "outsider";
const ROLES = { [ADMIN]: "ADMIN", [MANAGER]: "MANAGER", [DEVELOPER]: "DEVELOPER" } as Record<string, OrganizationRole>;

describe("tenant isolation", () => {
    it("hides an organization the caller doesn't belong to, as 404 not 403", async () => {
        // 403 would confirm the organization exists, which one tenant
        // should never learn about another.
        const { service } = harness(ROLES);

        await expect(service.listMembers(ORG, OUTSIDER)).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.listProjects(OTHER_ORG, ADMIN)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("hides a project belonging to another organization", async () => {
        const { service } = harness(ROLES, { project: { id: PROJECT, organizationId: OTHER_ORG, name: "Theirs" } });

        await expect(service.updateProject(ORG, MANAGER, PROJECT, "Renamed"))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("what each role may do", () => {
    it.each([
        ["developer", DEVELOPER, 403],
        ["manager", MANAGER, 200],
        ["admin", ADMIN, 200],
    ])("creating a project: %s", async (_label, user, expected) => {
        const { service } = harness(ROLES);
        const attempt = service.createProject(ORG, user, "Checkout");

        if (expected === 200) {
            expect((await attempt).name).toBe("Checkout");
        } else {
            await expect(attempt).rejects.toMatchObject({ statusCode: 403 });
        }
    });

    it.each([
        ["developer", DEVELOPER],
        ["manager", MANAGER],
    ])("managing members is admin-only: %s is refused", async (_label, user) => {
        const { service } = harness(ROLES);

        await expect(service.addMember(ORG, user, "new@acme.test", "DEVELOPER"))
            .rejects.toMatchObject({ statusCode: 403 });
        await expect(service.changeRole(ORG, user, DEVELOPER, "MANAGER"))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    it("lets any member read the organization's projects", async () => {
        const { service } = harness(ROLES);

        await expect(service.listProjects(ORG, DEVELOPER)).resolves.toEqual([]);
    });
});

describe("members", () => {
    it("adds someone by email, creating their user record on first invite", async () => {
        const { service, users, organizations } = harness(ROLES);

        const member = await service.addMember(ORG, ADMIN, "  New.Person@Acme.test ", "MANAGER");

        expect(users.create).toHaveBeenCalledWith("new.person@acme.test", "new.person@acme.test");
        expect(organizations.addMember).toHaveBeenCalledWith(ORG, "new-user", "MANAGER");
        expect(member.role).toBe("MANAGER");
    });

    it("refuses an invalid email or role", async () => {
        const { service } = harness(ROLES);

        await expect(service.addMember(ORG, ADMIN, "not-an-email", "DEVELOPER")).rejects.toThrow();
        await expect(service.addMember(ORG, ADMIN, "a@b.test", "OWNER" as OrganizationRole)).rejects.toThrow();
    });

    it("never leaves an organization without an admin", async () => {
        const { service } = harness(ROLES, { admins: 1 });

        await expect(service.changeRole(ORG, ADMIN, ADMIN, "DEVELOPER")).rejects.toMatchObject({ statusCode: 409 });
        await expect(service.removeMember(ORG, ADMIN, ADMIN)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("allows demoting an admin while another remains", async () => {
        const { service, organizations } = harness(ROLES, { admins: 2 });

        await service.changeRole(ORG, ADMIN, ADMIN, "MANAGER");

        expect(organizations.addMember).toHaveBeenCalledWith(ORG, ADMIN, "MANAGER");
    });
});

describe("organizations and projects", () => {
    it("creates an organization with its creator as admin and a readable slug", async () => {
        const { service, organizations } = harness({});

        const organization = await service.create("someone", "  Acme Payments  ");

        expect(organizations.createWithOwner).toHaveBeenCalledWith("Acme Payments", "acme-payments", "someone");
        expect(organization.slug).toBe("acme-payments");
    });

    it("adds a suffix when a slug is taken", async () => {
        const { service, organizations } = harness({});
        organizations.slugExists.mockResolvedValueOnce(true);

        const organization = await service.create("someone", "Acme");

        expect(organization.slug).toMatch(/^acme-[a-z0-9]{4,6}$/);
    });

    it("rejects names that are too short or too long", async () => {
        const { service } = harness({});

        await expect(service.create("someone", "A")).rejects.toThrow();
        await expect(service.createProject(ORG, MANAGER, "x".repeat(121))).rejects.toThrow();
    });

    it("files a repository under a project of the same organization", async () => {
        const { service, projects } = harness(ROLES);

        await service.assignRepository(ORG, MANAGER, "integration-1", PROJECT);

        expect(projects.assignRepository).toHaveBeenCalledWith("integration-1", ORG, PROJECT);
    });

    it("reports a repository that isn't the organization's as not found", async () => {
        const { service, projects } = harness(ROLES);
        projects.assignRepository.mockResolvedValueOnce(false);

        await expect(service.assignRepository(ORG, MANAGER, "someone-elses", PROJECT))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});

// ---------------------------------------------------------------------------
// Connecting a repository is an organization action, not a personal one.
// ---------------------------------------------------------------------------

describe("IntegrationService.initiateOAuth under multi-tenancy", () => {
    async function connectHarness(options: { alreadyConnected?: boolean } = {}) {
        const { IntegrationService } = await import("../src/services/IntegrationService.js");
        const organizationService = {
            requireRole: vi.fn(async (_org: string, userId: string) => {
                if (userId === DEVELOPER) {
                    const error = Object.assign(new Error("needs the manager role"), { statusCode: 403 });
                    throw error;
                }
                return "MANAGER";
            }),
            assertProjectInOrganization: vi.fn(async () => ({ id: PROJECT, organizationId: ORG })),
            requireMember: vi.fn(async () => "DEVELOPER"),
        };
        const integrationRepository = {
            findActiveInOrganization: vi.fn(async () =>
                options.alreadyConnected ? { id: "existing", status: "ACTIVE" } : null),
            findConnectionByUserAndRepo: vi.fn(async () => null),
            updateStatus: vi.fn(async () => undefined),
            createPending: vi.fn(async () => ({ id: "new-integration" })),
            findByOrganization: vi.fn(async () => []),
        };
        const adapter = { generateAuthorizationUrl: vi.fn(() => "https://github.com/login/oauth/authorize?x=1") };
        const service = new IntegrationService(
            integrationRepository as never,
            { create: () => adapter as never },
            organizationService as never
        );
        return { service, integrationRepository, organizationService };
    }

    const URL = "https://github.com/acme/shop";

    it("records the organization and project on the pending connection", async () => {
        const { service, integrationRepository } = await connectHarness();

        await service.initiateOAuth(MANAGER, URL, ORG, PROJECT);

        const args = integrationRepository.createPending.mock.calls[0];
        expect(args[args.length - 2]).toBe(ORG);
        expect(args[args.length - 1]).toBe(PROJECT);
    });

    it("refuses a developer: connecting a repository is a manager's job", async () => {
        const { service } = await connectHarness();

        await expect(service.initiateOAuth(DEVELOPER, URL, ORG)).rejects.toMatchObject({ statusCode: 403 });
    });

    it("refuses a repository the organization already connected", async () => {
        // Two connections would mean two webhooks and two analyses per PR.
        const { service } = await connectHarness({ alreadyConnected: true });

        await expect(service.initiateOAuth(MANAGER, URL, ORG)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("needs an organization", async () => {
        const { service } = await connectHarness();

        await expect(service.initiateOAuth(MANAGER, URL, "")).rejects.toThrow(/organizationId/);
    });
});
