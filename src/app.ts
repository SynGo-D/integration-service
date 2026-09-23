// src/app.ts

import express from "express";
import cors from "cors";

import { IntegrationService } from "./services/IntegrationService.js";
import { RepositoryPreviewService } from "./services/RepositoryPreviewService.js";
import { IntegrationController } from "./controllers/IntegrationController.js";
import { RepositoryPreviewController } from "./controllers/RepositoryPreviewController.js";

import { createIntegrationRoutes } from "./routes/IntegrationRoutes.js";
import { createRepositoryPreviewRoutes } from "./routes/RepositoryPreviewRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import { createInternalRoutes } from "./routes/InternalRoutes.js";
import { createOrganizationRoutes } from "./routes/OrganizationRoutes.js";
import { OrganizationController } from "./controllers/OrganizationController.js";
import { OrganizationService } from "./services/OrganizationService.js";

import { errorHandler } from "./middleware/errorHandler.js";
import { globalLimiter } from "./middleware/rateLimit.js";

const app = express();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

app.use(cors({
    origin: process.env.FRONTEND_ORIGIN ?? "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// Rate limiting runs *after* express.json(), not before: the per-route
// limiters key on `req.body.userId` (see middleware/rateLimit.ts), and the
// body isn't parsed yet at the top of the stack. It also runs after CORS so
// that a rejected request still carries CORS headers and the browser can
// read the 429 instead of reporting an opaque network error.
app.use(globalLimiter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
    res.json({
        service: "integration-service",
        status:  "healthy",
        phase:   1
    });
});

// ---------------------------------------------------------------------------
// Dependency injection — wire services → controllers → routes
// ---------------------------------------------------------------------------

const integrationService       = new IntegrationService();
const repositoryPreviewService = new RepositoryPreviewService();

const integrationController       = new IntegrationController(
    integrationService,
    repositoryPreviewService
);
const repositoryPreviewController = new RepositoryPreviewController(
    repositoryPreviewService
);

// ---------------------------------------------------------------------------
// Route mounting
// ---------------------------------------------------------------------------

// Repository preview (unauthenticated)
app.use("/api/repositories", createRepositoryPreviewRoutes(repositoryPreviewController));

// All integration endpoints: authorize, oauth/callback, list, getById, revoke
app.use("/api/integrations", createIntegrationRoutes(integrationController));

app.use("/api/organizations", createOrganizationRoutes(new OrganizationController(new OrganizationService())));

// User management
app.use("/api", userRoutes);

// Service-to-service (webhook-listener). Token-authenticated, never
// proxied by main-backend — see routes/InternalRoutes.ts.
app.use("/internal", createInternalRoutes(integrationService));

// ---------------------------------------------------------------------------
// Global error handler (must be last)
// ---------------------------------------------------------------------------

app.use(errorHandler);

export default app;