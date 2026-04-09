package com.fern.simulator.engine.phases;

import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.model.SimEmployee;
import com.fern.simulator.model.SimOutlet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;
import java.util.List;

/**
 * Phase 6: Generates payroll periods, timesheets, and payroll records.
 * <p>
 * On the 1st of each month, creates a payroll period for the previous month.
 * On the configured pay day, processes payroll for all active employees.
 */
public class PayrollPhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(PayrollPhase.class);
    private static final double STANDARD_DAILY_HOURS = 8.0;
    private static final double SALARIED_OVERTIME_PREMIUM = 0.35;

    @Override
    public String name() { return "Payroll"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        SimulationConfig.ProbabilityConfig prob = ctx.getConfig().probability();

        // Process payroll on pay day (default: 5th of each month)
        if (day.getDayOfMonth() == prob.payDayOfMonth() && !day.equals(ctx.getConfig().startDate())) {
            processPayroll(ctx, day, true);
        }
    }

    public void accrueFinalMonthIfNeeded(SimulationContext ctx, LocalDate day) {
        if (day.getDayOfMonth() != day.lengthOfMonth()) {
            return;
        }
        var finalMonth = ctx.getMonthSummary(day.getYear(), day.getMonthValue());
        if (finalMonth == null || finalMonth.getPayrollCost() > 0) {
            return;
        }
        processPayroll(ctx, day, false);
    }

    private void processPayroll(SimulationContext ctx, LocalDate day, boolean emitEvents) {
        LocalDate periodStart = emitEvents
                ? day.minusMonths(1).withDayOfMonth(1)
                : day.withDayOfMonth(1);
        LocalDate periodEnd = emitEvents
                ? day.minusMonths(1).withDayOfMonth(day.minusMonths(1).lengthOfMonth())
                : day;

        for (String regionCode : ctx.getActiveRegionCodes()) {
            List<SimEmployee> regionEmployees = ctx.getAllEmployees().stream()
                    .filter(e -> RegionalEconomics.countryCode(e.getRegionCode()).equals(regionCode))
                    .filter(e -> !e.getHireDate().isAfter(periodEnd))
                    .filter(e -> e.getTerminationDate() == null || !e.getTerminationDate().isBefore(periodStart))
                    .toList();

            if (regionEmployees.isEmpty()) continue;

            Long regionId = ctx.getRegionId(regionCode);
            if (regionId == null) continue;

            // Expected work days/hours in the period (weekdays only)
            int expectedWorkDays = countWeekdays(periodStart, periodEnd);
            double expectedWorkHours = expectedWorkDays * STANDARD_DAILY_HOURS;

            long periodId = ctx.getIdGen().nextId();
            String periodName = String.format("%s payroll %d-%02d", regionCode,
                    periodStart.getYear(), periodStart.getMonthValue());

            List<SimulationContext.PayrollTimesheetEntry> entries = new java.util.ArrayList<>();

            for (SimEmployee emp : regionEmployees) {
                // Determine actual days worked (hired after period start, or terminated before period end)
                LocalDate empStart = emp.getHireDate().isBefore(periodStart) ? periodStart : emp.getHireDate();
                LocalDate empEnd = emp.getTerminationDate() != null && emp.getTerminationDate().isBefore(periodEnd)
                        ? emp.getTerminationDate() : periodEnd;

                if (empStart.isAfter(empEnd)) continue;

                var workedShifts = ctx.getWorkedShifts(emp.getUserId()).stream()
                        .filter(shift -> !shift.workDate().isBefore(empStart) && !shift.workDate().isAfter(empEnd))
                        .filter(shift -> !"absent".equals(shift.attendanceStatus()) && !"leave".equals(shift.attendanceStatus()))
                        .toList();
                int actualWorkDays = (int) workedShifts.stream().map(SimulationContext.WorkedShiftRecord::workDate).distinct().count();
                double actualWorkHours = workedShifts.stream().mapToDouble(SimulationContext.WorkedShiftRecord::workHours).sum();
                int employeeExpectedWorkDays = countWeekdays(empStart, empEnd);
                double employeeExpectedWorkHours = employeeExpectedWorkDays * STANDARD_DAILY_HOURS;

                long netSalary;
                if ("hourly".equals(emp.getSalaryType())) {
                    netSalary = Math.max(0L, Math.round(emp.getBaseSalary() * actualWorkHours));
                } else {
                    double payableStandardHours = Math.min(actualWorkHours, employeeExpectedWorkHours);
                    long basePay = expectedWorkHours > 0
                            ? Math.max(0L, Math.round(emp.getBaseSalary() * (payableStandardHours / expectedWorkHours)))
                            : 0L;
                    double overtimeHours = workedShifts.stream()
                            .filter(SimulationContext.WorkedShiftRecord::overtime)
                            .mapToDouble(shift -> Math.max(0.0, shift.workHours() - STANDARD_DAILY_HOURS))
                            .sum();
                    double hourlyEquivalent = expectedWorkHours > 0 ? emp.getBaseSalary() / expectedWorkHours : 0.0;
                    long overtimePay = Math.max(0L, Math.round(hourlyEquivalent * overtimeHours * SALARIED_OVERTIME_PREMIUM));
                    netSalary = basePay + overtimePay;
                }

                // Compute attendance metrics from worked shift history
                var allShiftsInPeriod = ctx.getWorkedShifts(emp.getUserId()).stream()
                        .filter(shift -> !shift.workDate().isBefore(empStart) && !shift.workDate().isAfter(empEnd))
                        .toList();
                double overtimeHours = allShiftsInPeriod.stream()
                        .filter(SimulationContext.WorkedShiftRecord::overtime)
                        .mapToDouble(shift -> Math.max(0.0, shift.workHours() - STANDARD_DAILY_HOURS))
                        .sum();
                int lateCount = (int) allShiftsInPeriod.stream()
                        .filter(s -> "late".equals(s.attendanceStatus()))
                        .count();
                double absentDays = allShiftsInPeriod.stream()
                        .filter(s -> "absent".equals(s.attendanceStatus()) || "leave".equals(s.attendanceStatus()))
                        .map(SimulationContext.WorkedShiftRecord::workDate).distinct().count();
                Long approvedByUserId = ctx.getActiveEmployeesAtOutlet(emp.getOutletId()).stream()
                        .filter(e -> "outlet_manager".equals(e.getRoleCode()))
                        .map(SimEmployee::getUserId)
                        .findFirst().orElse(null);

                long timesheetId = ctx.getIdGen().nextId();
                long payrollId = ctx.getIdGen().nextId();

                // Find outlet for this employee
                Long outletId = emp.getOutletId() > 0 ? emp.getOutletId() : null;

                entries.add(new SimulationContext.PayrollTimesheetEntry(
                        timesheetId, payrollId, emp.getUserId(), outletId,
                        actualWorkDays, actualWorkHours, overtimeHours, 1.5,
                        lateCount, absentDays, approvedByUserId,
                        emp.getCurrencyCode(), emp.getBaseSalary(), netSalary));

                if (emitEvents) {
                    ctx.incrementRowCount("payroll_timesheet", 1);
                    ctx.incrementRowCount("payroll", 1);
                }
            }

            if (emitEvents) {
                ctx.addPayrollEvent(new SimulationContext.PayrollEvent(
                        periodId, regionId, periodName,
                        periodStart, periodEnd, day, entries));
            }

            // Track payroll cost
            long totalPayrollCost = entries.stream()
                    .mapToLong(SimulationContext.PayrollTimesheetEntry::netSalary).sum();
            long reportingPayrollCost = RegionalEconomics.convertToReportingCurrency(
                    totalPayrollCost, RegionalEconomics.currencyFor(regionCode));
            var payrollMonth = ctx.getMonthSummary(periodStart.getYear(), periodStart.getMonthValue());
            if (payrollMonth != null) {
                payrollMonth.addPayrollCost(reportingPayrollCost);
                if (emitEvents) {
                    payrollMonth.addPayroll();
                }
            } else if (ctx.getCurrentMonth() != null) {
                ctx.getCurrentMonth().addPayrollCost(reportingPayrollCost);
                if (emitEvents) {
                    ctx.getCurrentMonth().addPayroll();
                }
            }
            if (emitEvents) {
                ctx.incrementRowCount("payroll_period", 1);
            }

            // Emit payroll expense records + expense_payroll subtype
            for (var entry : entries) {
                Long outletId = entry.outletId();
                if (outletId == null) continue;
                SimOutlet outlet = ctx.getOutlets().get(outletId);
                if (outlet != null) {
                    outlet.addPayrollCostToPreviousMonth(
                            RegionalEconomics.convertToReportingCurrency(entry.netSalary(), entry.currencyCode()));
                }
                if (emitEvents) {
                    String currency = entry.currencyCode();
                    long expenseId = ctx.getIdGen().nextId();
                    Long managerUserId = ctx.getActiveEmployeesAtOutlet(outletId).stream()
                            .filter(e -> "outlet_manager".equals(e.getRoleCode()))
                            .map(SimEmployee::getUserId).findFirst().orElse(null);
                    ctx.addExpenseEvent(new SimulationContext.ExpenseEvent(
                            expenseId, outletId, day, currency, entry.netSalary(),
                            "payroll", "Payroll — " + periodName, null, managerUserId));
                    ctx.incrementRowCount("expense_record", 1);
                    ctx.addExpenseSubtypeEvent(new SimulationContext.ExpenseSubtypeEvent(
                            expenseId, "payroll", null, entry.payrollId()));
                    ctx.incrementRowCount("expense_payroll", 1);
                }
            }

            log.debug("{} payroll for region {} period {}-{}, {} employees",
                    emitEvents ? "Processed" : "Accrued",
                    regionCode, periodStart, periodEnd, regionEmployees.size());
        }
    }

    private int countWeekdays(LocalDate start, LocalDate end) {
        int weekdays = 0;
        for (LocalDate date = start; !date.isAfter(end); date = date.plusDays(1)) {
            if (date.getDayOfWeek().getValue() <= 5) {
                weekdays++;
            }
        }
        return weekdays;
    }
}
