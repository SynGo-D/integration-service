export interface ConnectIntegrationRequest {
    provider: "github" | "gitlab";
    token: string;
    userId: string;
}
