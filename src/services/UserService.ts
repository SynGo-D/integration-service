// src/services/UserService.ts

import { UserRepository } from "../repositories/UserRepository.js";
import { User } from "../models/User.js";

export class UserService {

    private readonly repository: UserRepository;

    constructor(repository?: UserRepository) {
        this.repository = repository ?? new UserRepository();
    }

    async createUser(email: string, fullName: string): Promise<User> {
        if (!email || typeof email !== "string") {
            throw new Error("Email is required.");
        }
        if (!fullName || typeof fullName !== "string") {
            throw new Error("Full name is required.");
        }

        // Idempotent: a returning user (e.g. cached identity was lost) gets
        // back their existing record instead of hitting an error. The
        // submitted fullName is ignored in that case.
        const existing = await this.repository.findByEmail(email);
        if (existing) {
            return existing;
        }

        return this.repository.create(email, fullName);
    }

    async getUserById(id: string): Promise<User | null> {
        return this.repository.findById(id);
    }
}