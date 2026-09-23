/**
 * Multi-tenancy: an organization owns its projects and the repositories
 * connected to them, and people reach them through a membership.
 *
 * The role lives on the membership, not on the user: the same person can
 * be an admin of one organization and a developer in another.
 */

export type OrganizationRole = "ADMIN" | "MANAGER" | "DEVELOPER";

/** What each role may do. Enforced in OrganizationService, not in the UI. */
export const ROLE_RANK: Record<OrganizationRole, number> = {
    DEVELOPER: 0,   // read analyses, rate AI review issues
    MANAGER:   1,   // + manage projects, connect repositories, edit business rules
    ADMIN:     2    // + manage the organization, its members and their roles
};

export interface Organization {
    id:        string;
    name:      string;
    slug:      string;
    createdAt: Date;
    updatedAt: Date;
}

/** An organization as one member sees it: the organization plus their own role in it. */
export interface OrganizationMembership {
    organization: Organization;
    role:         OrganizationRole;
}

export interface OrganizationMember {
    userId:   string;
    email:    string;
    fullName: string;
    role:     OrganizationRole;
    joinedAt: Date;
}

export interface Project {
    id:             string;
    organizationId: string;
    name:           string;
    slug:           string;
    description:    string | null;
    createdAt:      Date;
    updatedAt:      Date;
}

/** A project with the repositories filed under it, for the project picker and dashboards. */
export interface ProjectWithRepositories extends Project {
    repositories: Array<{
        integrationId:   string;
        provider:        "github" | "gitlab";
        repositoryOwner: string;
        repositoryName:  string;
        status:          string;
    }>;
}
