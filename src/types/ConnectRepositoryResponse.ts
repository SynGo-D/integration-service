import { RepositoryMetadata } from "./RepositoryMetadata";
import { ParsedResource } from "../interfaces/RepositoryProvider";

/**
 * Response for the repository connect flow.
 */
export interface ConnectRepositoryResponse {
    success: boolean;
    resource: RepositoryMetadata | ParsedResource;
}
