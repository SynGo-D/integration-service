import dotenv from "dotenv";
import app from "./app";
import { env } from "./config/env";
import { connectDatabase } from "./config/database";


/*
 * Load environment variables from the .env file.
 */
dotenv.config();

const PORT = env.PORT || 5001;

/*
    Start the Integration Service.

    The server only starts if the database
    connection succeeds.
*/
async function startServer() {
    await connectDatabase();

    app.listen(PORT, () => {
        console.log(`Integration Service running on port ${PORT}`);
    });
}

startServer();