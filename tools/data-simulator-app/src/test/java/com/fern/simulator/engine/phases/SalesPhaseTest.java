package com.fern.simulator.engine.phases;

import com.fern.simulator.engine.SimulationRandom;
import com.fern.simulator.model.SimOutlet;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SalesPhaseTest {

    @Test
    void partialBasketLossIsLowerThanFullMissedTicketValue() {
        long fullLoss = SalesPhase.effectiveLostBasketValue(180_000L, 0, 2);
        long partialLoss = SalesPhase.effectiveLostBasketValue(180_000L, 2, 1);

        assertEquals(180_000L, fullLoss);
        assertTrue(partialLoss > 0);
        assertTrue(partialLoss < fullLoss);
    }

    @Test
    void simulatorOrderChannelsUseOnlyDineInAndDelivery() {
        SimOutlet outlet = new SimOutlet(
                1L, "SIM-SMALL-OUT-0001", "Outlet", 1L,
                "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");

        Set<String> seenChannels = new HashSet<>();
        for (int seed = 1; seed <= 64; seed++) {
            String channel = SalesPhase.inferOrderType(
                    outlet,
                    seed % 2 == 0 ? "lunch" : "dinner",
                    LocalDate.of(2024, 4, 1).plusDays(seed % 7),
                    new SimulationRandom(seed));
            assertTrue(Set.of("dine_in", "delivery").contains(channel));
            seenChannels.add(channel);
        }

        assertTrue(!seenChannels.isEmpty());
    }
}
