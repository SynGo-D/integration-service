import { User } from "../models/User";
import { UserRepository } from "../repositories/UserRepository";

export class UserService {

    constructor(
        private readonly userRepository: UserRepository
    ) {}

    async createUser(
        email: string,
        fullName: string
    ): Promise<User> {

        if (!email || !fullName) {
            throw new Error("Email and full name are required.");
        }

        const existingUser = await this.userRepository.findByEmail(email);

        if (existingUser) {
            throw new Error("A user with this email already exists.");
        }

        return this.userRepository.create(email, fullName);
    }

    async getUserById(id: string): Promise<User> {

        const user = await this.userRepository.findById(id);

        if (!user) {
            throw new Error("User not found.");
        }

        return user;
    }

    async getAllUsers(): Promise<User[]> {
        return this.userRepository.findAll();
    }

    async deleteUser(id: string): Promise<void> {

        const deleted = await this.userRepository.delete(id);

        if (!deleted) {
            throw new Error("User not found.");
        }
    }
}