// src/errors/AppError.ts

/**
 * Base class for all application-level errors.
 *
 * Throw an AppError (or a subclass) whenever the error is caused by the
 * caller's input or a predictable business-logic condition.
 * Use the global errorHandler middleware to convert it into an HTTP response.
 */
export class AppError extends Error {

    public readonly statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
        // Restore prototype chain so instanceof checks work after transpilation
        Object.setPrototypeOf(this, AppError.prototype);
    }
}
