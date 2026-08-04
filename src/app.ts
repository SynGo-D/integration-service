import express from "express";
import cors from "cors";
import { IntegrationService } from "./services/IntegrationService";
import { IntegrationController } from "./controllers/IntegrationController";
import { createIntegrationRoutes } from "./routes/IntegrationRoutes";
import { errorHandler } from "./middleware/errorHandler";
import { validateConnectIntegration, validateUUIDParam } from "./middleware/validation";
import { rateLimiter } from "./middleware/rateLimit";

const app = express();

app.use(rateLimiter);

const integrationService = new IntegrationService();
const integrationController = new IntegrationController(integrationService);
const integrationRoutes = createIntegrationRoutes(integrationController);

app.use(rateLimiter);
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
    res.json({
        service: "integration-service",
        status: "healthy"
    });
});

app.post("/integrations/connect", validateConnectIntegration, (req, res) => integrationController.connect(req, res));
app.get("/integrations", (req, res) => integrationController.list(req, res));
app.post("/integrations/:id/sync", validateUUIDParam, (req, res) => integrationController.sync(req, res));
app.get("/integrations/:id/repositories", validateUUIDParam, (req, res) => integrationController.listRepositories(req, res));

app.use(errorHandler);

export default app;