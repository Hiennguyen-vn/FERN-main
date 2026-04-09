package com.fern.simulator.engine.phases;

import com.fern.simulator.engine.SimulationContext;

import java.time.LocalDate;

/**
 * A phase handler processes one aspect of business simulation for a given day.
 * Phases are executed in strict order to maintain causal consistency.
 */
public interface PhaseHandler {

    /**
     * @return the display name of this phase (e.g. "Expansion", "Sales")
     */
    String name();

    /**
     * Execute this phase for the given simulation day.
     *
     * @param ctx the current simulation context (mutable shared state)
     * @param day the day being simulated
     */
    void execute(SimulationContext ctx, LocalDate day);
}
