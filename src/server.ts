import app from "./app";
import { env } from "./config/env";

/**
 * Starts the HTTP server.
 */
function startServer(): void {

    app.listen(env.port, () => {

        console.log(
            `Integration Service running on port ${env.port}`
        );

    });

}

startServer();