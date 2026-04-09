package com.dorabets.common.spring.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.dorabets.common.middleware.ServiceException;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

class ServiceExceptionHandlerTest {

  private final ServiceExceptionHandler handler = new ServiceExceptionHandler();

  @Test
  void validationErrorsReturnStableFieldDetails() throws Exception {
    BeanPropertyBindingResult bindingResult = new BeanPropertyBindingResult(
        new ValidationPayload(""),
        "loginRequest"
    );
    bindingResult.rejectValue("username", "NotBlank", "must not be blank");
    Method method = ValidationController.class.getDeclaredMethod("submit", ValidationPayload.class);
    MethodArgumentNotValidException exception = new MethodArgumentNotValidException(
        new MethodParameter(method, 0),
        bindingResult
    );

    ResponseEntity<Map<String, Object>> response = handler.handleValidation(exception);

    assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
    assertEquals("validation_error", response.getBody().get("error"));
    assertEquals("Request validation failed", response.getBody().get("message"));
    Object details = response.getBody().get("details");
    assertInstanceOf(List.class, details);
    @SuppressWarnings("unchecked")
    Map<String, String> firstDetail = ((List<Map<String, String>>) details).getFirst();
    assertEquals("username", firstDetail.get("field"));
    assertEquals("must not be blank", firstDetail.get("message"));
  }

  @Test
  void unexpectedErrorsDoNotLeakInternalCause() {
    ResponseEntity<Map<String, Object>> response = handler.handleUnexpected(
        new IllegalStateException("database exploded", new RuntimeException("sensitive root cause"))
    );

    assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
    assertEquals("internal_error", response.getBody().get("error"));
    assertEquals("An unexpected error occurred", response.getBody().get("message"));
    assertFalse(response.getBody().containsKey("cause"));
    assertFalse(response.getBody().containsKey("details"));
  }

  @Test
  void serviceExceptionsPreserveIntentionalStatusAndMessage() {
    ResponseEntity<Map<String, Object>> response = handler.handleServiceException(
        ServiceException.forbidden("Forbidden for this outlet")
    );

    assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
    assertEquals("forbidden", response.getBody().get("error"));
    assertEquals("Forbidden for this outlet", response.getBody().get("message"));
  }

  @Test
  void serviceExceptionsPreserveStructuredDetails() {
    List<Map<String, Object>> details = List.of(
        Map.of(
            "type", "insufficient_stock",
            "itemCode", "BEAN-001",
            "shortQuantity", "2.0000"
        )
    );

    ResponseEntity<Map<String, Object>> response = handler.handleServiceException(
        ServiceException.conflict("Stock is insufficient", details)
    );

    assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
    assertEquals("conflict", response.getBody().get("error"));
    assertEquals("Stock is insufficient", response.getBody().get("message"));
    assertEquals(details, response.getBody().get("details"));
  }

  @Test
  void missingRoutesReturnNotFoundInsteadOfInternalError() {
    ResponseEntity<Map<String, Object>> response = handler.handleNotFound(
        new NoResourceFoundException(org.springframework.http.HttpMethod.GET, "/api/v1/auth/route-probe")
    );

    assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
    assertEquals("not_found", response.getBody().get("error"));
    assertEquals("Resource not found", response.getBody().get("message"));
  }

  @SuppressWarnings("unused")
  private static final class ValidationController {
    private void submit(ValidationPayload payload) {
    }
  }

  private record ValidationPayload(String username) {
  }
}
