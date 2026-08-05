import "dotenv/config";

export const env = {
    PORT: Number(process.env.PORT),

    DB_HOST: process.env.DB_HOST!,

    DB_PORT: Number(process.env.DB_PORT),

    DB_NAME: process.env.DB_NAME!,

    DB_USER: process.env.DB_USER!,

    DB_PASSWORD: process.env.DB_PASSWORD!,

    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY ?? "default-token-key-change-me",
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? "",
    GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL ?? ""
};