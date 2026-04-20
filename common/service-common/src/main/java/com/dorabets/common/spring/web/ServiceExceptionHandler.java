package com.dorabets.common.spring.web;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.idempotency.IdempotencyConflictException;
import java.sql.SQLException;
import java.time.Instant;
import org.springframework.dao.DataIntegrityViolationException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ServiceExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(ServiceExceptionHandler.class);

  @ExceptionHandler(ServiceException.class)
  public ResponseEntity<Map<String, Object>> handleServiceException(ServiceException exception) {
    return response(
        HttpStatus.valueOf(exception.getStatusCode()),
        exception.getErrorCode(),
        exception.getMessage() != null ? exception.getMessage() : exception.toString(),
        exception.getDetails()
    );
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException exception) {
    List<Map<String, String>> details = exception.getBindingResult().getFieldErrors().stream()
        .map(this::mapFieldError)
        .collect(Collectors.toList());
    if (details.isEmpty()) {
      details = exception.getBindingResult().getGlobalErrors().stream()
          .map(error -> Map.of(
              "field", error.getObjectName(),
              "message", error.getDefaultMessage() == null ? "Validation failed" : error.getDefaultMessage()
          ))
          .collect(Collectors.toList());
    }
    return response(HttpStatus.BAD_REQUEST, "validation_error", "Request validation failed", details);
  }

  @ExceptionHandler({
      ConstraintViolationException.class,
      MissingServletRequestParameterException.class,
      MethodArgumentTypeMismatchException.class,
      IllegalArgumentException.class
  })
  public ResponseEntity<Map<String, Object>> handleBadRequest(Exception exception) {
    Object details = null;
    String message = exception.getMessage() == null ? "Invalid request" : exception.getMessage();
    if (exception instanceof ConstraintViolationException constraintViolationException) {
      details = constraintViolationException.getConstraintViolations().stream()
          .map(violation -> Map.of(
              "field", violation.getPropertyPath().toString(),
              "message", violation.getMessage()
          ))
          .collect(Collectors.toList());
      message = "Request validation failed";
    }
    return response(HttpStatus.BAD_REQUEST, "bad_request", message, details);
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<Map<String, Object>> handleMalformedJson(HttpMessageNotReadableException exception) {
    return response(HttpStatus.BAD_REQUEST, "invalid_json", "Malformed JSON request body", null);
  }

  @ExceptionHandler(IdempotencyConflictException.class)
  public ResponseEntity<Map<String, Object>> handleIdempotencyConflict(IdempotencyConflictException exception) {
    return response(
        HttpStatus.CONFLICT,
        "idempotency_conflict",
        exception.getMessage() == null ? "Idempotency key reused with different payload" : exception.getMessage(),
        null
    );
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  public ResponseEntity<Map<String, Object>> handleDataIntegrity(DataIntegrityViolationException exception) {
    log.warn("Data integrity violation", exception);
    Throwable root = exception.getMostSpecificCause();
    String rootMessage = root != null && root.getMessage() != null ? root.getMessage() : exception.getMessage();
    String summary = summarizeIntegrityMessage(rootMessage);
    return response(HttpStatus.UNPROCESSABLE_ENTITY, "data_integrity_error", summary, null);
  }

  @ExceptionHandler(SQLException.class)
  public ResponseEntity<Map<String, Object>> handleSql(SQLException exception) {
    log.error("Unhandled SQL exception", exception);
    String summary = summarizeIntegrityMessage(exception.getMessage());
    Map<String, Object> details = new LinkedHashMap<>();
    details.put("sqlState", exception.getSQLState());
    return response(HttpStatus.UNPROCESSABLE_ENTITY, "sql_error", summary, details);
  }

  private String summarizeIntegrityMessage(String raw) {
    if (raw == null || raw.isBlank()) return "Database constraint violation";
    String firstLine = raw.split("\\r?\\n", 2)[0];
    return firstLine.length() > 300 ? firstLine.substring(0, 300) + "..." : firstLine;
  }

  @ExceptionHandler(NoResourceFoundException.class)
  public ResponseEntity<Map<String, Object>> handleNotFound(NoResourceFoundException exception) {
    return response(HttpStatus.NOT_FOUND, "not_found", "Resource not found", null);
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, Object>> handleUnexpected(Exception exception) {
    log.error("Unexpected error", exception);
    return response(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "internal_error",
        "An unexpected error occurred",
        null
    );
  }

  private Map<String, String> mapFieldError(FieldError fieldError) {
    Map<String, String> detail = new LinkedHashMap<>();
    detail.put("field", fieldError.getField());
    detail.put("message", fieldError.getDefaultMessage() == null ? "Validation failed" : fieldError.getDefaultMessage());
    if (fieldError.getCode() != null) {
      detail.put("code", fieldError.getCode());
    }
    return detail;
  }

  private ResponseEntity<Map<String, Object>> response(
      HttpStatus status,
      String error,
      String message,
      Object details
  ) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("timestamp", Instant.now().toString());
    body.put("error", error);
    body.put("message", message);
    if (details != null) {
      body.put("details", details);
    }
    return ResponseEntity.status(status).body(body);
  }
}
