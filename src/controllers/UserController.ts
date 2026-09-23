// src/controllers/UserController.ts

import { Request, Response } from "express";
import { AppError } from "../errors/AppError.js";
import { ValidationError } from "../errors/ValidationError.js";
import { AuthService } from "../services/AuthService.js";

/**
 * Registration and sign-in. main-backend is the only caller: it turns the
 * user returned here into a session token.
 *
 * Nothing in this file logs a request body — it holds a password.
 */
export class UserController {

    private readonly auth: AuthService;

    constructor(auth?: AuthService) {
        this.auth = auth ?? new AuthService();
    }

    register = async (req: Request, res: Response): Promise<void> => {
        try {
            const { email, fullName, password } = req.body as {
                email?: string; fullName?: string; password?: string;
            };

            const user = await this.auth.register(email ?? "", fullName ?? "", password ?? "");

            res.status(201).json({ success: true, data: user });
        } catch (error) {
            this.handleError(res, error);
        }
    };

    authenticate = async (req: Request, res: Response): Promise<void> => {
        try {
            const { email, password } = req.body as { email?: string; password?: string };

            const user = await this.auth.authenticate(email ?? "", password ?? "");

            res.status(200).json({ success: true, data: user });
        } catch (error) {
            this.handleError(res, error);
        }
    };

    private handleError(res: Response, error: unknown): void {
        if (error instanceof ValidationError) {
            res.status(400).json({ success: false, message: error.message });
            return;
        }
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ success: false, message: error.message });
            return;
        }

        // The message is left out on purpose: whatever went wrong happened
        // while handling a password.
        console.error("[auth] unexpected error");
        res.status(500).json({ success: false, message: "Internal server error." });
    }
}
