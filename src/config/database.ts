// src/config/database.ts

import { Pool } from "pg";
import { env } from "./env.js";

/**
 * Shared PostgreSQL connection pool.
 *
 * All repositories use this pool rather than opening their own connections.
 * The pool is configured with sensible defaults; tune `max` and `idleTimeoutMillis`
 * for production based on expected concurrency.
 */
export const pool = new Pool({
    host:     env.DB_HOST,
    port:     env.DB_PORT,
    database: env.DB_NAME,
    user:     env.DB_USER,
    password: env.DB_PASSWORD,
    max:      10,                  // maximum number of clients in the pool
    idleTimeoutMillis: 30_000,     // close idle clients after 30 s
    connectionTimeoutMillis: 5_000 // throw after 5 s if no connection available
});

/**
 * Verifies that the database is reachable during server startup.
 * Exits the process if the connection cannot be established.
 */
export async function connectDatabase(): Promise<void> {
    try {
        const result = await pool.query("SELECT NOW();");
        console.log("Integration Service connected to PostgreSQL.", result.rows[0]);
    } catch (error) {
        console.error("Failed to connect to PostgreSQL:", error);
        process.exit(1);
    }
}