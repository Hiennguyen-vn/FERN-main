package com.fern.simulator.engine;

import com.fern.simulator.config.ConfigLoader;
import com.fern.simulator.model.SimItem;
import com.fern.simulator.model.SimOutlet;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SimulationContextStockTrackingTest {

    @Test
    void marksOnlyTouchedStockForPersistence() throws Exception {
        SimulationContext ctx = new SimulationContext(ConfigLoader.loadPreset("small"), false);
        ctx.advanceToDay(LocalDate.of(2024, 1, 1));

        SimOutlet outlet = new SimOutlet(100L, "SIM-SMALL-OUT-0001", "Outlet", 1L, "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");
        ctx.addOutlet(outlet);

        SimItem item = new SimItem(200L, "SIM-SMALL-ITEM-0001", "Rice", 1L, "NOODLE", 1L, "kg",
                50_000L, false, 10, 50, "low", 21, 0.08, 0.05);
        ctx.addItem(item);
        ctx.initOutletStock(outlet.getId(), item.copyForOutlet());
        ctx.clearDirtyState();

        ctx.addStock(outlet.getId(), item.getId(), 25);
        ctx.removeStock(outlet.getId(), item.getId(), 5);

        assertEquals(20, ctx.getOutletStock(outlet.getId(), item.getId()).getCurrentStock());
        assertTrue(ctx.getDirtyStockItems(outlet.getId()).contains(item.getId()));
    }

    @Test
    void carriesForwardUnmetDemandAcrossFutureDays() throws Exception {
        SimulationContext ctx = new SimulationContext(ConfigLoader.loadPreset("small"), false);
        ctx.advanceToDay(LocalDate.of(2024, 1, 1));

        SimOutlet outlet = new SimOutlet(100L, "SIM-SMALL-OUT-0001", "Outlet", 1L, "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");
        ctx.addOutlet(outlet);

        ctx.addUnmetDemand(outlet.getId(), 20, 200_000L);
        assertTrue(ctx.totalCarryoverDemand(outlet.getId()) > 0);

        ctx.advanceToDay(LocalDate.of(2024, 1, 2));
        assertTrue(ctx.getCurrentCarryoverDemand(outlet.getId()) > 0);
    }

    @Test
    void recognizesStockoutLossAsRecoverableDemandNotFullFaceValue() throws Exception {
        SimulationContext ctx = new SimulationContext(ConfigLoader.loadPreset("small"), false);
        ctx.advanceToDay(LocalDate.of(2024, 1, 1));

        SimOutlet outlet = new SimOutlet(101L, "SIM-SMALL-OUT-0002", "Outlet", 1L, "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");
        ctx.addOutlet(outlet);

        ctx.addUnmetDemand(outlet.getId(), 12, 240_000L);

        assertTrue(outlet.getTotalLostSalesValue() > 0);
        assertTrue(outlet.getTotalLostSalesValue() < 120_000L);
        assertTrue(ctx.totalCarryoverDemand(outlet.getId()) > 0);
    }
}
