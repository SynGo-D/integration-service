import { Request, Response } from "express";
import { UserService } from "../services/UserService";

export class UserController {

    constructor(
        private readonly userService: UserService
    ) {}

    async createUser(req: Request, res: Response): Promise<void> {

        try {

            const { email, fullName } = req.body;

            const user = await this.userService.createUser(
                email,
                fullName
            );

            res.status(201).json(user);

        } catch (error) {

            if (error instanceof Error) {

                switch (error.message) {

                    case "Email and full name are required.":
                        res.status(400).json({
                            message: error.message
                        });
                        return;

                    case "A user with this email already exists.":
                        res.status(409).json({
                            message: error.message
                        });
                        return;

                }

                res.status(500).json({
                    message: error.message
                });

                return;
            }

            res.status(500).json({
                message: "Internal Server Error"
            });

        }

    }

    async getUser(req: Request, res: Response): Promise<void> {

        try {

            const { id } = req.params;

            const user = await this.userService.getUserById(id);

            res.status(200).json(user);

        } catch (error) {

            if (
                error instanceof Error &&
                error.message === "User not found."
            ) {

                res.status(404).json({
                    message: error.message
                });

                return;

            }

            res.status(500).json({
                message: "Internal Server Error"
            });

        }

    }

    async getUsers(req: Request, res: Response): Promise<void> {

        try {

            const users = await this.userService.getAllUsers();

            res.status(200).json(users);

        } catch {

            res.status(500).json({
                message: "Internal Server Error"
            });

        }

    }

    async deleteUser(req: Request, res: Response): Promise<void> {

        try {

            const { id } = req.params;

            await this.userService.deleteUser(id);

            res.sendStatus(204);

        } catch (error) {

            if (
                error instanceof Error &&
                error.message === "User not found."
            ) {

                res.status(404).json({
                    message: error.message
                });

                return;

            }

            res.status(500).json({
                message: "Internal Server Error"
            });

        }

    }

}