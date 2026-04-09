package com.fern.simulator.engine.phases;

import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.engine.SimulationRandom;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.model.SimOutlet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;

/**
 * Phase 9: Generates operating expenses (rent, utilities, maintenance) on month-end.
 * <p>
 * Runs on the last day of each month to record fixed and variable operating costs.
 */
public class ExpensePhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(ExpensePhase.class);

    @Override
    public String name() { return "Expenses"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        // Only run on last day of month
        if (day.getDayOfMonth() != day.lengthOfMonth()) return;

        SimulationRandom rng = ctx.getRandom();

        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            var expenseProfile = RegionalEconomics.expenseProfile(
                    outlet,
                    ctx.getConfig().startDate(),
                    day,
                    outlet.getActiveStaffCount(),
                    outlet.getCurrentMonthCompletedSales());
            int activeSubregionOutlets = Math.toIntExact(ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()));
            int activeCountryOutlets = Math.toIntExact(ctx.countActiveOutletsInCountry(outlet.getRegionCode()));
            double sharedServicesMultiplier = RegionalEconomics.sharedServicesMultiplier(
                    activeSubregionOutlets,
                    activeCountryOutlets);
            String currency = expenseProfile.currencyCode();

            long rent = Math.max(0L, Math.round(expenseProfile.rent() * rng.doubleBetween(0.96, 1.05)));
            emitExpense(ctx, outlet, day, currency, rent, "operating_expense",
                    "Monthly rent — " + outlet.getCode());

            long utilities = Math.max(0L, Math.round(expenseProfile.utilities()
                    * sharedServicesMultiplier * rng.doubleBetween(0.95, 1.06)));
            emitExpense(ctx, outlet, day, currency, utilities, "operating_expense",
                    "Utilities (water, electricity, internet) — " + outlet.getCode());

            long maintenance = Math.max(0L, Math.round(expenseProfile.maintenance()
                    * sharedServicesMultiplier * rng.doubleBetween(0.94, 1.08)));
            emitExpense(ctx, outlet, day, currency, maintenance, "operating_expense",
                    "Maintenance & repairs — " + outlet.getCode());

            long reportingOperatingCost = RegionalEconomics.convertToReportingCurrency(rent + utilities + maintenance, currency);
            ctx.getCurrentMonth().addOperatingCost(reportingOperatingCost);
            outlet.addOperatingCost(reportingOperatingCost);

            log.trace("Operating expenses for outlet {}: rent={}k, util={}k, maint={}k",
                    outlet.getCode(), rent / 1000, utilities / 1000, maintenance / 1000);
        }
    }

    private void emitExpense(SimulationContext ctx, SimOutlet outlet, LocalDate day,
                              String currency, long amount, String sourceType, String description) {
        long expenseId = ctx.getIdGen().nextId();
        Long managerUserId = ctx.getActiveEmployeesAtOutlet(outlet.getId()).stream()
                .filter(e -> "outlet_manager".equals(e.getRoleCode()))
                .map(com.fern.simulator.model.SimEmployee::getUserId).findFirst().orElse(null);
        ctx.addExpenseEvent(new SimulationContext.ExpenseEvent(
                expenseId, outlet.getId(), day, currency, amount, sourceType, description, null, managerUserId));
        ctx.incrementRowCount("expense_record", 1);
        // Emit expense subtype detail
        ctx.addExpenseSubtypeEvent(new SimulationContext.ExpenseSubtypeEvent(
                expenseId, "operating", description, null));
        ctx.incrementRowCount("expense_operating", 1);
    }
}
