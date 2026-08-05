import { Router } from "express";

import { UserRepository } from "../repositories/UserRepository";
import { UserService } from "../services/UserService";
import { UserController } from "../controllers/UserController";

const router = Router();

// Dependency Injection
const userRepository = new UserRepository();
const userService = new UserService(userRepository);
const userController = new UserController(userService);

// Create User
router.post(
    "/users",
    (req, res) => userController.createUser(req, res)
);

// Get All Users
router.get(
    "/users",
    (req, res) => userController.getUsers(req, res)
);

// Get User By ID
router.get(
    "/users/:id",
    (req, res) => userController.getUser(req, res)
);

// Delete User
router.delete(
    "/users/:id",
    (req, res) => userController.deleteUser(req, res)
);

export default router;