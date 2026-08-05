import express from "express";
import cors from "cors";
import { IntegrationService } from "./services/IntegrationService";
import { IntegrationController } from "./controllers/IntegrationController";
import { createIntegrationRoutes } from "./routes/IntegrationRoutes";
import { RepositoryPreviewController } from "./controllers/RepositoryPreviewController";
import { createRepositoryPreviewRoutes } from "./routes/RepositoryPreviewRoutes";
import { errorHandler } from "./middleware/errorHandler";
import { validateConnectIntegration, validateUUIDParam } from "./middleware/validation";
import { rateLimiter } from "./middleware/rateLimit";

const app = express();

app.use(rateLimiter);
app.use(cors());
app.use(express.json());

const integrationService = new IntegrationService();
const integrationController = new IntegrationController(integrationService);
const integrationRoutes = createIntegrationRoutes(integrationController);
const repositoryPreviewController = new RepositoryPreviewController();
const repositoryPreviewRoutes = createRepositoryPreviewRoutes(repositoryPreviewController);

app.get("/health", (req, res) => {
    res.json({
        service: "integration-service",
        status: "healthy"
    });
});

app.use("/api/repositories", repositoryPreviewRoutes);
app.use("/integrations", integrationRoutes);
app.get("/api/integrations/github/oauth/start", (req, res) => integrationController.startGithubOAuth(req, res));
app.get("/api/integrations/github/oauth/callback", (req, res) => integrationController.githubOAuthCallback(req, res));

app.use(errorHandler);

export default app;