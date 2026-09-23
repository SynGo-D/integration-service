// src/routes/OrganizationRoutes.ts

import { Router } from "express";
import { OrganizationController } from "../controllers/OrganizationController.js";

/**
 * Multi-tenancy routes. Every one of them acts as the user in the
 * `X-User-Id` header (set by main-backend from the verified session) and
 * is checked against that user's membership and role in the service.
 *
 *  GET    /api/organizations                                  organizations I belong to, with my role
 *  POST   /api/organizations                                  create one (creator becomes ADMIN)
 *  GET    /api/organizations/:organizationId                  one organization + my role
 *
 *  GET    /api/organizations/:organizationId/members          members and their roles
 *  POST   /api/organizations/:organizationId/members          add by email                      (ADMIN)
 *  PATCH  /api/organizations/:organizationId/members/:memberUserId   change role                (ADMIN)
 *  DELETE /api/organizations/:organizationId/members/:memberUserId   remove                     (ADMIN)
 *
 *  GET    /api/organizations/:organizationId/projects         projects with their repositories
 *  POST   /api/organizations/:organizationId/projects         create                            (MANAGER)
 *  PATCH  /api/organizations/:organizationId/projects/:projectId     rename / describe          (MANAGER)
 *  DELETE /api/organizations/:organizationId/projects/:projectId     delete (repositories stay) (MANAGER)
 *
 *  PUT    /api/organizations/:organizationId/repositories/:integrationId/project
 *                                                             file a repository under a project (MANAGER)
 */
export function createOrganizationRoutes(controller: OrganizationController): Router {
    const router = Router();

    router.get("/", controller.listOrganizations);
    router.post("/", controller.createOrganization);
    router.get("/:organizationId", controller.getOrganization);

    router.get("/:organizationId/members", controller.listMembers);
    router.post("/:organizationId/members", controller.addMember);
    router.patch("/:organizationId/members/:memberUserId", controller.changeMemberRole);
    router.delete("/:organizationId/members/:memberUserId", controller.removeMember);

    router.get("/:organizationId/projects", controller.listProjects);
    router.post("/:organizationId/projects", controller.createProject);
    router.patch("/:organizationId/projects/:projectId", controller.updateProject);
    router.delete("/:organizationId/projects/:projectId", controller.deleteProject);

    router.put("/:organizationId/repositories/:integrationId/project", controller.assignRepository);

    return router;
}
