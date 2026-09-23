// src/routes/userRoutes.ts

import { Router } from "express";
import { UserController } from "../controllers/UserController.js";
import { signInLimiter } from "../middleware/rateLimit.js";

const router     = Router();
const controller = new UserController();

/**
 * POST /api/users/register    — create an account, or set the password of
 *                               one an admin added by email
 * POST /api/users/authenticate — check an email and password
 *
 * There is no "find or create by email" endpoint any more: that is what
 * signing in used to be, and it let anyone in as anyone.
 */
router.post("/users/register", signInLimiter, controller.register);
router.post("/users/authenticate", signInLimiter, controller.authenticate);

export default router;
