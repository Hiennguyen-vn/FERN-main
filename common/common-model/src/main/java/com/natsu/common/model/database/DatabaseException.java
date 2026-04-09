package com.natsu.common.model.database;

/**
 * Exception thrown for database-related errors.
 */
public class DatabaseException extends RuntimeException {

    private final String database;
    private final String operation;

    public DatabaseException(String message) {
        super(message);
        this.database = null;
        this.operation = null;
    }

    public DatabaseException(String message, Throwable cause) {
        super(message, cause);
        this.database = null;
        this.operation = null;
    }

    public DatabaseException(String database, String message) {
        super("[" + database + "] " + message);
        this.database = database;
        this.operation = null;
    }

    public DatabaseException(String database, String operation, String message) {
        super("[" + database + "] " + operation + ": " + message);
        this.database = database;
        this.operation = operation;
    }

    public DatabaseException(String database, String operation, String message, Throwable cause) {
        super("[" + database + "] " + operation + ": " + message, cause);
        this.database = database;
        this.operation = operation;
    }

    public String getDatabase() {
        return database;
    }

    public String getOperation() {
        return operation;
    }
}
