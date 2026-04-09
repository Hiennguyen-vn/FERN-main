package com.dorabets.common.middleware;

public class ServiceException extends RuntimeException {

    private final int statusCode;
    private final String errorCode;
    private final Object details;

    public ServiceException(int statusCode, String errorCode, String message) {
        this(statusCode, errorCode, message, null);
    }

    public ServiceException(int statusCode, String errorCode, String message, Object details) {
        super(message);
        this.statusCode = statusCode;
        this.errorCode = errorCode;
        this.details = details;
    }

    public int getStatusCode() { return statusCode; }
    public String getErrorCode() { return errorCode; }
    public Object getDetails() { return details; }

    public static ServiceException notFound(String message) {
        return new ServiceException(404, "not_found", message);
    }

    public static ServiceException badRequest(String message) {
        return new ServiceException(400, "bad_request", message);
    }

    public static ServiceException forbidden(String message) {
        return new ServiceException(403, "forbidden", message);
    }

    public static ServiceException unauthorized(String message) {
        return new ServiceException(401, "unauthorized", message);
    }

    public static ServiceException conflict(String message) {
        return new ServiceException(409, "conflict", message);
    }

    public static ServiceException conflict(String message, Object details) {
        return new ServiceException(409, "conflict", message, details);
    }

    public static ServiceException insufficientBalance(String message) {
        return new ServiceException(422, "insufficient_balance", message);
    }
}
