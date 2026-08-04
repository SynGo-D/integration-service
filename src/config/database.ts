
// Import PostgreSQL connection pool
//import "dotenv/config";
import { Pool } from "pg";
import { env } from "./env";


/*
    Create a shared connection pool.

    Every repository in the application
    will use this pool instead of opening
    its own database connection.
*/
export const pool = new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
});

/*
    Helper function to verify that the
    database is reachable during startup.
*/
export async function connectDatabase(): Promise<void> {
    try {
        await pool.query("SELECT NOW();");
        console.log("Integration Service connected to PostgreSQL.");
    } catch (error) {
        console.error("Failed to connect to PostgreSQL.", error);
        process.exit(1);
    }
}