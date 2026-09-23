// src/errors/ValidationError.ts

import { AppError } from "./AppError.js";

/**
 * Thrown when request input fails validation.
 * Maps to HTTP 422 Unprocessable Entity.
 */
export class ValidationError extends AppError {
    constructor(message = "Validation failed.") {
        super(message, 422);
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}
