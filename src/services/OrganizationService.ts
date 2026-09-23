import { AppError } from "../errors/AppError.js";
import { ValidationError } from "../errors/ValidationError.js";
import { OrganizationRepository } from "../repositories/OrganizationRepository.js";
import { ProjectRepository } from "../repositories/ProjectRepository.js";
import { UserRepository } from "../repositories/UserRepository.js";
import {
    ROLE_RANK,
    type Organization,
    type OrganizationMember,
    type OrganizationMembership,
    type OrganizationRole,
    type Project,
    type ProjectWithRepositories
} from "../models/Organization.js";

const ROLES: OrganizationRole[] = ["ADMIN", "MANAGER", "DEVELOPER"];

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2_000;

/**
 * Organizations, their members and their projects.
 *
 * Every method that touches an organization's data takes the *acting*
 * user and checks their membership first. That check lives here, not in
 * the controllers or the UI: this service is the boundary that decides
 * whether one tenant may see or change another's data.
 *
 * What each role may do (ROLE_RANK in models/Organization.ts):
 *   DEVELOPER  read the organization, its projects and repositories
 *   MANAGER    + create and edit projects, file repositories under them
 *   ADMIN      + rename the organization, manage members and their roles
 */
export class OrganizationService {

    private readonly organizations: OrganizationRepository;
    private readonly projects: ProjectRepository;
    private readonly users: UserRepository;

    constructor(
        organizations?: OrganizationRepository,
        projects?: ProjectRepository,
        users?: UserRepository
    ) {
        this.organizations = organizations ?? new OrganizationRepository();
        this.projects = projects ?? new ProjectRepository();
        this.users = users ?? new UserRepository();
    }

    // -----------------------------------------------------------------------
    // Access
    // -----------------------------------------------------------------------

    /**
     * The caller's role in an organization, or a 404 when they aren't a
     * member.
     *
     * 404 rather than 403 on purpose: answering "forbidden" would confirm
     * that an organization with that id exists, which is not something one
     * tenant should learn about another.
     */
    async requireMember(organizationId: string, userId: string): Promise<OrganizationRole> {
        const role = organizationId && userId
            ? await this.organizations.roleOf(organizationId, userId)
            : null;

        if (role === null) {
            throw new AppError("Organization not found.", 404);
        }
        return role;
    }

    /** As requireMember, and also that the role is at least `minimum`. */
    async requireRole(
        organizationId: string,
        userId: string,
        minimum: OrganizationRole
    ): Promise<OrganizationRole> {
        const role = await this.requireMember(organizationId, userId);

        if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
            throw new AppError(
                `This action needs the ${minimum.toLowerCase()} role; yours is ${role.toLowerCase()}.`,
                403
            );
        }
        return role;
    }

    // -----------------------------------------------------------------------
    // Organizations
    // -----------------------------------------------------------------------

    async listForUser(userId: string): Promise<OrganizationMembership[]> {
        if (!userId) {
            throw new ValidationError("userId is required.");
        }
        return this.organizations.findForUser(userId);
    }

    /** Creates an organization with its creator as ADMIN. */
    async create(userId: string, name: string): Promise<Organization> {
        if (!userId) {
            throw new ValidationError("userId is required.");
        }
        const cleanName = this.cleanName(name, "Organization name");
        const slug = await this.uniqueOrganizationSlug(cleanName);

        return this.organizations.createWithOwner(cleanName, slug, userId);
    }

    async get(organizationId: string, userId: string): Promise<{ organization: Organization; role: OrganizationRole }> {
        const role = await this.requireMember(organizationId, userId);
        const organization = await this.organizations.findById(organizationId);

        if (organization === null) {
            throw new AppError("Organization not found.", 404);
        }
        return { organization, role };
    }

    // -----------------------------------------------------------------------
    // Members
    // -----------------------------------------------------------------------

    async listMembers(organizationId: string, userId: string): Promise<OrganizationMember[]> {
        await this.requireMember(organizationId, userId);
        return this.organizations.members(organizationId);
    }

    /**
     * Adds someone by email, creating the user record if this is their
     * first time on the platform, and returns the updated member list.
     *
     * There is no email invitation yet: the person is added directly, and
     * sees the organization the next time they sign in.
     */
    async addMember(
        organizationId: string,
        actingUserId: string,
        email: string,
        role: OrganizationRole,
        fullName?: string
    ): Promise<OrganizationMember> {
        await this.requireRole(organizationId, actingUserId, "ADMIN");
        this.assertRole(role);

        const cleanEmail = (email ?? "").trim().toLowerCase();
        if (!cleanEmail || !cleanEmail.includes("@") || cleanEmail.length > 255) {
            throw new ValidationError("A valid email address is required.");
        }

        const user = await this.users.findByEmail(cleanEmail)
            ?? await this.users.create(cleanEmail, (fullName ?? "").trim() || cleanEmail);

        await this.organizations.addMember(organizationId, user.id, role);

        return {
            userId:   user.id,
            email:    user.email,
            fullName: user.fullName,
            role,
            joinedAt: new Date()
        };
    }

    async changeRole(
        organizationId: string,
        actingUserId: string,
        memberUserId: string,
        role: OrganizationRole
    ): Promise<void> {
        await this.requireRole(organizationId, actingUserId, "ADMIN");
        this.assertRole(role);

        const current = await this.organizations.roleOf(organizationId, memberUserId);
        if (current === null) {
            throw new AppError("That person is not a member of this organization.", 404);
        }

        // An organization with no admin can't be administered again, and
        // nothing in the API could restore it.
        if (current === "ADMIN" && role !== "ADMIN" && await this.organizations.adminCount(organizationId) === 1) {
            throw new AppError("An organization needs at least one admin.", 409);
        }

        await this.organizations.addMember(organizationId, memberUserId, role);
    }

    async removeMember(organizationId: string, actingUserId: string, memberUserId: string): Promise<void> {
        await this.requireRole(organizationId, actingUserId, "ADMIN");

        const current = await this.organizations.roleOf(organizationId, memberUserId);
        if (current === null) {
            throw new AppError("That person is not a member of this organization.", 404);
        }
        if (current === "ADMIN" && await this.organizations.adminCount(organizationId) === 1) {
            throw new AppError("An organization needs at least one admin.", 409);
        }

        await this.organizations.removeMember(organizationId, memberUserId);
    }

    // -----------------------------------------------------------------------
    // Projects
    // -----------------------------------------------------------------------

    async listProjects(organizationId: string, userId: string): Promise<ProjectWithRepositories[]> {
        await this.requireMember(organizationId, userId);
        return this.projects.findForOrganization(organizationId);
    }

    async createProject(
        organizationId: string,
        userId: string,
        name: string,
        description?: string | null
    ): Promise<Project> {
        await this.requireRole(organizationId, userId, "MANAGER");

        const cleanName = this.cleanName(name, "Project name");
        const slug = await this.uniqueProjectSlug(organizationId, cleanName);

        return this.projects.create(organizationId, cleanName, slug, this.cleanDescription(description));
    }

    async updateProject(
        organizationId: string,
        userId: string,
        projectId: string,
        name: string,
        description?: string | null
    ): Promise<Project> {
        await this.requireRole(organizationId, userId, "MANAGER");
        await this.requireProjectInOrganization(organizationId, projectId);

        const updated = await this.projects.update(
            projectId,
            this.cleanName(name, "Project name"),
            this.cleanDescription(description)
        );

        if (updated === null) {
            throw new AppError("Project not found.", 404);
        }
        return updated;
    }

    async deleteProject(organizationId: string, userId: string, projectId: string): Promise<void> {
        await this.requireRole(organizationId, userId, "MANAGER");
        await this.requireProjectInOrganization(organizationId, projectId);

        await this.projects.delete(projectId);
    }

    /**
     * Files a connected repository under a project, or removes it from one
     * (projectId null). Both must belong to this organization.
     */
    async assignRepository(
        organizationId: string,
        userId: string,
        integrationId: string,
        projectId: string | null
    ): Promise<void> {
        await this.requireRole(organizationId, userId, "MANAGER");

        if (projectId !== null) {
            await this.requireProjectInOrganization(organizationId, projectId);
        }

        const assigned = await this.projects.assignRepository(integrationId, organizationId, projectId);
        if (!assigned) {
            throw new AppError("Repository not found in this organization.", 404);
        }
    }

    /** Throws 404 unless the project belongs to this organization. */
    async assertProjectInOrganization(organizationId: string, projectId: string): Promise<Project> {
        return this.requireProjectInOrganization(organizationId, projectId);
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private async requireProjectInOrganization(organizationId: string, projectId: string): Promise<Project> {
        const project = await this.projects.findById(projectId);

        // Same reasoning as requireMember: never reveal that a project of
        // another organization exists.
        if (project === null || project.organizationId !== organizationId) {
            throw new AppError("Project not found.", 404);
        }
        return project;
    }

    private assertRole(role: OrganizationRole): void {
        if (!ROLES.includes(role)) {
            throw new ValidationError(`role must be one of ${ROLES.join(", ")}.`);
        }
    }

    private cleanName(name: string, label: string): string {
        const clean = (name ?? "").trim();
        if (clean.length < 2 || clean.length > MAX_NAME_LENGTH) {
            throw new ValidationError(`${label} must be between 2 and ${MAX_NAME_LENGTH} characters.`);
        }
        return clean;
    }

    private cleanDescription(description?: string | null): string | null {
        const clean = (description ?? "").trim();
        if (clean.length > MAX_DESCRIPTION_LENGTH) {
            throw new ValidationError(`Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
        }
        return clean || null;
    }

    /** "Acme Payments" → "acme-payments", with a suffix if that's taken. */
    private async uniqueOrganizationSlug(name: string): Promise<string> {
        const base = this.slugify(name);

        for (let attempt = 0; attempt < 5; attempt++) {
            const slug = attempt === 0 ? base : `${base}-${this.randomSuffix()}`;
            if (!await this.organizations.slugExists(slug)) {
                return slug;
            }
        }
        throw new AppError("Could not find a free name for this organization. Try a different one.", 409);
    }

    private async uniqueProjectSlug(organizationId: string, name: string): Promise<string> {
        const base = this.slugify(name);

        for (let attempt = 0; attempt < 5; attempt++) {
            const slug = attempt === 0 ? base : `${base}-${this.randomSuffix()}`;
            if (!await this.projects.slugExists(organizationId, slug)) {
                return slug;
            }
        }
        throw new AppError("Could not find a free name for this project. Try a different one.", 409);
    }

    private slugify(name: string): string {
        const slug = name
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40);

        // A name written entirely in a non-Latin script leaves nothing to
        // slugify; the suffix keeps the URL usable.
        return slug || `org-${this.randomSuffix()}`;
    }

    private randomSuffix(): string {
        return Math.random().toString(36).slice(2, 8);
    }
}
