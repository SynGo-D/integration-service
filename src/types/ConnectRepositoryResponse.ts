import { RepositoryMetadata } from "./RepositoryMetadata";
import { ParsedResource } from "../interfaces/RepositoryProvider";

/**
 * Response for the repository connect flow.
 */
/**
 * Response returned when attempting to connect to
 * a repository or organization URL.
 */
export interface ConnectRepositoryResponse {
    success: boolean;
    resource: RepositoryMetadata | ParsedResource;
}
