import express from "express";
import cors from "cors";

const app = express();

/*
    Global middleware.
*/

// Allow JSON request bodies.
app.use(express.json());

// Allow cross-origin requests.
app.use(cors());

/*
    Health endpoint.

    Used by Docker, Kubernetes,
    or other services to verify
    that this service is running.
*/
app.get("/health", (req, res) => {

    res.status(200).json({
        status: "UP",
        service: "integration-service"
    });

});

export default app;