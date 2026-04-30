package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.*;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class LoyaltyPointsTest {

  @Test
  void zeroForNullOrNegative() {
    assertEquals(0, LoyaltyService.pointsFor(null));
    assertEquals(0, LoyaltyService.pointsFor(BigDecimal.ZERO));
    assertEquals(0, LoyaltyService.pointsFor(new BigDecimal("-100")));
  }

  @Test
  void floorsToTenThousandVnd() {
    assertEquals(0, LoyaltyService.pointsFor(new BigDecimal("9999")));
    assertEquals(1, LoyaltyService.pointsFor(new BigDecimal("10000")));
    assertEquals(1, LoyaltyService.pointsFor(new BigDecimal("19999.99")));
    assertEquals(5, LoyaltyService.pointsFor(new BigDecimal("55555")));
    assertEquals(123, LoyaltyService.pointsFor(new BigDecimal("1230000")));
  }

  @Test
  void redeemConstantsSane() {
    assertEquals(100, LoyaltyService.REDEEM_POINTS);
    assertEquals(0, new BigDecimal("20000").compareTo(LoyaltyService.REDEEM_VOUCHER_VND));
  }
}
