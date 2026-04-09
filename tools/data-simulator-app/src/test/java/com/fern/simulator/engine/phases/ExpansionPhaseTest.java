package com.fern.simulator.engine.phases;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fern.simulator.config.ConfigLoader;
import com.fern.simulator.engine.SimulationContext;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class ExpansionPhaseTest {

    @Test
    void doesNotCreateDefaultOutletsWhenInitialOutletsIsZero() throws Exception {
        SimulationContext ctx = new SimulationContext(ConfigLoader.loadDefault(), false);
        LocalDate startDay = ctx.getConfig().startDate();

        new ExpansionPhase().execute(ctx, startDay);

        assertEquals(0, ctx.getOutlets().size());
        assertTrue(ctx.getActiveOutlets().isEmpty());
        assertTrue(ctx.getDirtyOutlets().isEmpty());
        assertTrue(ctx.getActiveRegionCodes().contains("VN"));
        assertTrue(ctx.getActiveSubregionCodes().contains("VN-HCM"));
    }
}
