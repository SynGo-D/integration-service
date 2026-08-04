import { ParsedResource } from "../interfaces/RepositoryProvider";

/**
 * Response returned to the frontend.
 */
export interface ConnectRepositoryResponse {

    success: boolean;

    resource: ParsedResource;

}