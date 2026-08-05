import { pool } from "../config/database";
import { User } from "../models/User";

export class UserRepository {

    async create(
        email: string,
        fullName: string
    ): Promise<User> {

        const result = await pool.query(
            `
            INSERT INTO users (
                email,
                full_name
            )
            VALUES ($1, $2)
            RETURNING
                id,
                email,
                full_name,
                created_at,
                updated_at;
            `,
            [email, fullName]
        );

        return this.mapRow(result.rows[0]);
    }

    async findById(id: string): Promise<User | null> {

        const result = await pool.query(
            `
            SELECT *
            FROM users
            WHERE id = $1;
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return this.mapRow(result.rows[0]);
    }

    async findByEmail(email: string): Promise<User | null> {

        const result = await pool.query(
            `
            SELECT *
            FROM users
            WHERE email = $1;
            `,
            [email]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return this.mapRow(result.rows[0]);
    }

    async findAll(): Promise<User[]> {

        const result = await pool.query(
            `
            SELECT *
            FROM users
            ORDER BY created_at DESC;
            `
        );

        return result.rows.map(row => this.mapRow(row));
    }

    async delete(id: string): Promise<boolean> {

        const result = await pool.query(
            `
            DELETE FROM users
            WHERE id = $1;
            `,
            [id]
        );

        return result.rowCount !== null && result.rowCount > 0;
    }

    private mapRow(row: any): User {

        return {
            id: row.id,
            email: row.email,
            fullName: row.full_name,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}