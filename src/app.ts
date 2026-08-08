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

import { errorHandler } from "./middleware/errorHandler.js";
import { rateLimiter } from "./middleware/rateLimit.js";

const app = express();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

app.use(rateLimiter);

app.use(cors({
    origin: process.env.FRONTEND_ORIGIN ?? "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

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

// User management
app.use("/api", userRoutes);

// ---------------------------------------------------------------------------
// Global error handler (must be last)
// ---------------------------------------------------------------------------

app.use(errorHandler);

export default app;