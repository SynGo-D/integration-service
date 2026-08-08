// src/routes/userRoutes.ts

import { Router } from "express";
import { UserController } from "../controllers/UserController.js";

const router     = Router();
const controller = new UserController();

/**
 * POST /api/users — create a new user
 */
router.post("/users", controller.createUser);

export default router;