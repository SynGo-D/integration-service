import { pool } from "../config/database";
import { User } from "../models/User";

export class UserRepository {


    async create(
        email: string,
        fullName: string
    ): Promise<User> {


        const query = `
            INSERT INTO users
            (
                email,
                full_name
            )
            VALUES
            ($1,$2)

            RETURNING
                id,
                email,
                full_name,
                created_at,
                updated_at
        `;


        const result = await pool.query(
            query,
            [
                email,
                fullName
            ]
        );


        const row = result.rows[0];


        return {
            id: row.id,
            email: row.email,
            fullName: row.full_name,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }



    async findByEmail(
        email:string
    ):Promise<User | null>{


        const query = `
            SELECT
                id,
                email,
                full_name,
                created_at,
                updated_at

            FROM users

            WHERE email=$1
        `;


        const result =
            await pool.query(
                query,
                [email]
            );


        if(result.rows.length===0){
            return null;
        }


        const row=result.rows[0];


        return {
            id: row.id,
            email: row.email,
            fullName: row.full_name,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}