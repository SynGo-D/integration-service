import axios, { AxiosInstance } from "axios";

/*
 * Handles all communication with GitHub REST API.
 * This class is responsible ONLY for making HTTP requests.
 */
export class GitHubApiClient {

    private readonly client: AxiosInstance;

    constructor() {

        this.client = axios.create({

            baseURL: "https://api.github.com",

            timeout: 5000,

            headers: {
                Accept: "application/vnd.github+json"
            }

        });

    }

    /*
     * Retrieve public repository details.
     */
    async getRepository(owner: string, repository: string) {

        const response = await this.client.get(
            `/repos/${owner}/${repository}`
        );

        return response.data;

    }

    /*
     * Retrieve organization details.
     */
    async getOrganization(organization: string) {

        const response = await this.client.get(
            `/orgs/${organization}`
        );

        return response.data;

    }

    /*
     * Retrieve repository languages.
     */
    async getLanguages(owner: string, repository: string) {

        const response = await this.client.get(
            `/repos/${owner}/${repository}/languages`
        );

        return response.data;

    }

    /*
     * Retrieve repository contributors.
     */
    async getContributors(owner: string, repository: string) {

        const response = await this.client.get(
            `/repos/${owner}/${repository}/contributors`
        );

        return response.data;

    }

    /*
     * Retrieve repositories inside an organization.
     */
    async getOrganizationRepositories(organization: string) {

        const response = await this.client.get(

            `/orgs/${organization}/repos`

        );

        return response.data;

    }

}