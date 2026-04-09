package com.fern.simulator.economics;

import com.fern.simulator.model.SimOutlet;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;

class OutletBusinessControllerTest {

    @Test
    void stockoutOrdersPerDayUsesMissedOrderCountsInsteadOfLossDollars() {
        SimOutlet outlet = new SimOutlet(
                1L, "SIM-SMALL-OUT-0001", "Outlet", 1L,
                "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");

        outlet.recordCompletedSale(90_000L);
        outlet.recordCompletedSale(110_000L);
        outlet.recordSaleAttempt(true);
        outlet.recordSaleAttempt(true);
        outlet.recordSaleAttempt(true);
        outlet.addStockoutLostSalesValue(9_000_000L);

        double stockoutOrdersPerDay = OutletBusinessController.stockoutOrdersPerDay(
                outlet, LocalDate.of(2024, 1, 3));

        assertEquals(1.0, stockoutOrdersPerDay, 0.001);
    }
}
