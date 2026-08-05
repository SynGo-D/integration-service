import { UserRepository } from "../repositories/UserRepository";
import { User } from "../models/User";


export class UserService {


    private repository:UserRepository;


    constructor(){

        this.repository =
            new UserRepository();

    }



    async createUser(
        email:string,
        fullName:string
    ):Promise<User>{


        const existing =
            await this.repository.findByEmail(email);



        if(existing){

            throw new Error(
                "User already exists"
            );

        }



        return await this.repository.create(
            email,
            fullName
        );

    }

}