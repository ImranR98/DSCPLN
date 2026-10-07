'use strict'

class AppError extends Error {
    constructor(message, statusCode) {
        super(message)
        this.name = this.constructor.name
        this.statusCode = statusCode
    }
}

class ValidationError extends AppError {
    constructor(message) {
        super(message, 400)
    }
}

class UnauthorizedError extends AppError {
    constructor(message) {
        super(message, 401)
    }
}

class ConflictError extends AppError {
    constructor(message) {
        super(message, 409)
    }
}

class UnprocessableError extends AppError {
    constructor(message) {
        super(message, 422)
    }
}

module.exports = { ValidationError, UnauthorizedError, ConflictError, UnprocessableError }
