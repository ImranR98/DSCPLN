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

class ConflictError extends AppError {
    constructor(message) {
        super(message, 409)
    }
}

module.exports = { ValidationError, ConflictError }
