package com.fern.simulator.engine.phases;

import com.fern.simulator.config.ConfigLoader;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.model.SimItem;
import com.fern.simulator.model.SimOutlet;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InventoryPhaseTest {

    @Test
    void expiresOldLotsIntoWasteRecords() throws Exception {
        SimulationContext ctx = new SimulationContext(ConfigLoader.loadPreset("small"), false);
        LocalDate day = LocalDate.of(2024, 1, 5);
        ctx.advanceToDay(day);

        SimOutlet outlet = new SimOutlet(10L, "SIM-SMALL-OUT-0001", "Outlet", 1L, "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");
        ctx.addOutlet(outlet);

        SimItem item = new SimItem(20L, "SIM-SMALL-ITEM-0001", "Shrimp", 1L, "PROTEIN", 1L, "g",
                120L, false, 10, 100, "very_high", 2, 0.45, 0.20);
        ctx.addItem(item);
        ctx.initOutletStock(outlet.getId(), item.copyForOutlet());
        ctx.clearDirtyState();
        ctx.addInventoryLot(outlet.getId(), item.getId(), 30,
                LocalDate.of(2024, 1, 1), LocalDate.of(2024, 1, 1), LocalDate.of(2024, 1, 3), "test-lot");

        new InventoryPhase().execute(ctx, day);

        assertFalse(ctx.getDirtyWasteRecords().isEmpty());
        assertTrue(ctx.getDirtyWasteRecords().stream().anyMatch(waste -> waste.reason().contains("Expired")));
    }
}
