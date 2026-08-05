import { Request, Response } from "express";
import { UserService } from "../services/UserService";


export class UserController {


    private service:UserService;


    constructor(){

        this.service =
            new UserService();

    }



    createUser = async(
        req:Request,
        res:Response
    )=>{


        try{


            const {
                email,
                fullName
            } = req.body;



            const user =
                await this.service.createUser(
                    email,
                    fullName
                );



            res.status(201)
               .json(user);



        }catch(error:any){


            res.status(400)
               .json({
                    message:error.message
               });

        }

    }

}