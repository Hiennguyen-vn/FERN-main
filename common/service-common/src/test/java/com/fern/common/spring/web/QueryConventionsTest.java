package com.fern.common.spring.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fern.common.middleware.ServiceException;
import org.junit.jupiter.api.Test;

class QueryConventionsTest {

  @Test
  void normalizeQueryTrimsBlankAndCapsLength() {
    assertNull(QueryConventions.normalizeQuery("   "));
    assertEquals("coffee", QueryConventions.normalizeQuery("  coffee  "));

    String tooLong = "x".repeat(101);
    ServiceException exception = assertThrows(
        ServiceException.class,
        () -> QueryConventions.normalizeQuery(tooLong)
    );
    assertEquals(400, exception.getStatusCode());
  }
}
