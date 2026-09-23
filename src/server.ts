// src/server.ts

import "dotenv/config";
import app from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase } from "./config/database.js";

/**
 * Integration Service entry point.
 *
 * Responsibilities:
 *  1. Load environment variables (dotenv/config)
 *  2. Verify database connectivity
 *  3. Start the HTTP server
 *
 * Route registration and middleware are handled in app.ts.
 */
async function startServer(): Promise<void> {
    await connectDatabase();

    app.listen(env.PORT, () => {
        console.log(`Integration Service running on port ${env.PORT}`);
        console.log(`Health: http://localhost:${env.PORT}/health`);
    });
}

startServer().catch((error) => {
    console.error("Failed to start Integration Service:", error);
    process.exit(1);
});