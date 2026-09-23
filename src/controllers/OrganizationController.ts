import { Request, Response } from "express";
import { AppError } from "../errors/AppError.js";
import { ValidationError } from "../errors/ValidationError.js";
import { OrganizationService } from "../services/OrganizationService.js";
import type { OrganizationRole } from "../models/Organization.js";

/**
 * HTTP for organizations, members and projects. No business rules here:
 * who may do what is decided in OrganizationService, which every handler
 * passes the acting user to.
 *
 * That user comes from the `X-User-Id` header, which main-backend sets
 * from the verified session. This service is internal — only main-backend
 * can reach it — so the header is trusted here, exactly as
 * analysis-engine trusts it for review feedback.
 */
export class OrganizationController {

    constructor(private readonly service: OrganizationService) {}

    listOrganizations = async (req: Request, res: Response): Promise<void> => {
        try {
            const memberships = await this.service.listForUser(this.actingUser(req));
            res.status(200).json({ success: true, data: memberships });
        } catch (error) {
            this.handleError(res, error);
        }
    };

    createOrganization = async (req: Request, res: Response): Promise<void> => {
        try {
            const { name } = req.body as { name?: string };
            const organization = await this.service.create(this.actingUser(req), name ?? "");
            res.status(201).json({ success: true, data: organization });
        } catch (error) {
            this.handleError(res, error);
        }
    };

    getOrganization = async (req: Request, res: Response): Promise<void> => {
        try {
            const data = await this.service.get(this.param(req, "organizationId"), this.actingUser(req));
            res.status(200).json({ success: true, data });
        } catch (error) {
            this.handleError(res, error);
        }
    };

    // -----------------------------------------------------------------------
    // Members
    // -----------------------------------------------------------------------

    listMembers = async (req: Request, res: Response): Promise<void> => {
        try {
            const members = await this.service.listMembers(
                this.param(req, "organizationId"),
                this.actingUser(req)
            );
            res.status(200).json({ success: true, data: members });
        } catch (error) {
            this.handleError(res, error);
        }
    };

    addMember = async (req: Request, res: Response): Promise<void> => {
        try {
            const { email, role, fullName } = req.body as {
                email?: string; role?: OrganizationRole; fullName?: string;
            };

            const member = await this.service.addMember(
                this.param(req, "organizationId"),
                this.actingUser(req),
                email ?? "",
                role ?? "DEVELOPER",
                fullName
            );
            res.status(201).json({ success: true, data: member });
        } catch (error) {
            this.handleError(res, error);
        }
    };

    changeMemberRole = async (req: Request, res: Response): Promise<void> => {
        try {
            const { role } = req.body as { role?: OrganizationRole };

            await this.service.changeRole(
                this.param(req, "organizationId"),
                this.actingUser(req),
                this.param(req, "memberUserId"),
                role ?? "DEVELOPER"
            );
            res.status(204).end();
        } catch (error) {
            this.handleError(res, error);
        }
    };

    removeMember = async (req: Request, res: Response): Promise<void> => {
        try {
            await this.service.removeMember(
                this.param(req, "organizationId"),
                this.actingUser(req),
                this.param(req, "memberUserId")
            );
            res.status(204).end();
        } catch (error) {
            this.handleError(res, error);
        }
    };

    // -----------------------------------------------------------------------
    // Projects
    // -----------------------------------------------------------------------

    listProjects = async (req: Request, res: Response): Promise<void> => {
        try {
            const projects = await this.service.listProjects(
                this.param(req, "organizationId"),
                this.actingUser(req)
            );
            res.status(200).json({ success: true, data: projects });
        } catch (error) {
            this.handleError(res, error);
        }
    };

    createProject = async (req: Request, res: Response): Promise<void> => {
        try {
            const { name, description } = req.body as { name?: string; description?: string };

            const project = await this.service.createProject(
                this.param(req, "organizationId"),
                this.actingUser(req),
                name ?? "",
                description
            );
            res.status(201).json({ success: true, data: project });
        } catch (error) {
            this.handleError(res, error);
        }
    };

    updateProject = async (req: Request, res: Response): Promise<void> => {
        try {
            const { name, description } = req.body as { name?: string; description?: string };

            const project = await this.service.updateProject(
                this.param(req, "organizationId"),
                this.actingUser(req),
                this.param(req, "projectId"),
                name ?? "",
                description
            );
            res.status(200).json({ success: true, data: project });
        } catch (error) {
            this.handleError(res, error);
        }
    };

    deleteProject = async (req: Request, res: Response): Promise<void> => {
        try {
            await this.service.deleteProject(
                this.param(req, "organizationId"),
                this.actingUser(req),
                this.param(req, "projectId")
            );
            res.status(204).end();
        } catch (error) {
            this.handleError(res, error);
        }
    };

    /** Files a connected repository under a project, or unfiles it (projectId: null). */
    assignRepository = async (req: Request, res: Response): Promise<void> => {
        try {
            const { projectId } = req.body as { projectId?: string | null };

            await this.service.assignRepository(
                this.param(req, "organizationId"),
                this.actingUser(req),
                this.param(req, "integrationId"),
                projectId ?? null
            );
            res.status(204).end();
        } catch (error) {
            this.handleError(res, error);
        }
    };

    // -----------------------------------------------------------------------

    private actingUser(req: Request): string {
        const userId = req.header("X-User-Id");

        if (!userId) {
            throw new AppError("This request must carry the signed-in user.", 401);
        }
        return userId;
    }

    /** Express 5 types route params as string | string[]; these routes never repeat one. */
    private param(req: Request, name: string): string {
        const value = req.params[name];

        if (typeof value !== "string" || !value) {
            throw new ValidationError(`Invalid path parameter '${name}'.`);
        }
        return value;
    }

    private handleError(res: Response, error: unknown): void {
        if (error instanceof ValidationError) {
            res.status(400).json({ success: false, message: error.message });
            return;
        }
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ success: false, message: error.message });
            return;
        }

        console.error("[organizations] unexpected error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
}
