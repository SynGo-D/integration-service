import express from "express";
import cors from "cors";

const app = express();

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
    res.status(200).json({
        service: "integration-service",
        status: "healthy"
    });
});

export default app;