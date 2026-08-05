import { Router } from "express";
import { UserController } from "../controllers/UserController";


const router = Router();


const controller =
    new UserController();



router.post(
    "/users",
    controller.createUser
);


export default router;