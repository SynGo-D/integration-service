import dotenv from "dotenv";

// Load environment variables from the .env file.
dotenv.config();

/**
 * Returns an environment variable or throws an error if it is missing.
 */
function requiredEnv(name: string): string {

    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing environment variable: ${name}`);
    }

    return value;
}

/**
 * Centralized application configuration.
 */
export const env = {

    // HTTP server port.
    port: Number(process.env.PORT) || 5001,

};