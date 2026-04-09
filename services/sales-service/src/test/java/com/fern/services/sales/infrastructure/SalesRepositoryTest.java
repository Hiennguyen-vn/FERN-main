package com.fern.services.sales.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dorabets.common.middleware.ServiceException;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class SalesRepositoryTest {

  @Test
  void convertRecipeQuantityToStockUomUsesConfiguredConversionFactor() {
    BigDecimal converted = SalesRepository.convertRecipeQuantityToStockUom(
        new BigDecimal("92.0000"),
        "g",
        "kg",
        new BigDecimal("0.00100000"),
        "COFFEE-BEAN"
    );

    assertEquals(0, converted.compareTo(new BigDecimal("0.092")));
  }

  @Test
  void convertRecipeQuantityToStockUomRejectsMissingConversionForMismatchedUnits() {
    ServiceException exception = assertThrows(
        ServiceException.class,
        () -> SalesRepository.convertRecipeQuantityToStockUom(
            new BigDecimal("18.0000"),
            "g",
            "kg",
            null,
            "COFFEE-BEAN"
        )
    );

    assertEquals(400, exception.getStatusCode());
  }
}
