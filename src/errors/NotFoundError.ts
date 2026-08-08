// src/errors/NotFoundError.ts

import { AppError } from "./AppError.js";

export class NotFoundError extends AppError {
    constructor(message = "Resource not found.") {
        super(message, 404);
        Object.setPrototypeOf(this, NotFoundError.prototype);
    }
}
