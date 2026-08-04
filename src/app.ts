import express from "express";
import cors from "cors";
import { ProviderFactory } from "./factories/ProviderFactory";
import { IntegrationService } from "./services/IntegrationService";
import { IntegrationController } from "./controllers/IntegrationController";
import { createIntegrationRoutes } from "./routes/IntegrationRoutes";
const app = express();

// Create instances of the services and controllers
const providerFactory = new ProviderFactory();
const integrationService = new IntegrationService(providerFactory);
const integrationController = new IntegrationController(integrationService);
const integrationRoutes = createIntegrationRoutes(integrationController);

// Use the integration routes
app.use("/integration", integrationRoutes);

/*
 * Allow requests from other origins (Next.js frontend).
 */
app.use(cors());

/*
 * Automatically parse incoming JSON request bodies.
 */
app.use(express.json());

/*
 * Temporary health endpoint.
 * Used to verify that the service is running.
 */
app.get("/health", (req, res) => {

    res.json({

        service: "integration-service",

        status: "healthy"

    });

});

app.use(
    "/integrations",
    createIntegrationRoutes(
        integrationController
    )
);

export default app;