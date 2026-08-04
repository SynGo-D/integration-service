import { AppError } from "./AppError";

export class ValidationError extends AppError {
    constructor(message = "Validation failed.") {
        super(message, 422);
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}
