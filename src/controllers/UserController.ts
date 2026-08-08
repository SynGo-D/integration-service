// src/controllers/UserController.ts

import { Request, Response } from "express";
import { UserService } from "../services/UserService.js";

export class UserController {

    private readonly service: UserService;

    constructor(service?: UserService) {
        this.service = service ?? new UserService();
    }

    createUser = async (req: Request, res: Response): Promise<void> => {
        try {
            const { email, fullName } = req.body as {
                email:    string;
                fullName: string;
            };

            if (!email || !fullName) {
                res.status(400).json({
                    success: false,
                    message: "email and fullName are required."
                });
                return;
            }

            const user = await this.service.createUser(email, fullName);

            res.status(201).json({
                success: true,
                data:    user
            });

        } catch (error: any) {
            res.status(400).json({
                success: false,
                message: error.message ?? "Failed to create user."
            });
        }
    };
}