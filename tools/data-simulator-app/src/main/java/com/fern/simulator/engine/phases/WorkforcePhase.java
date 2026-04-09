package com.fern.simulator.engine.phases;

import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.engine.SimulationRandom;
import com.fern.simulator.engine.StatusTransitions;
import com.fern.simulator.economics.OutletEconomicsModel;
import com.fern.simulator.economics.OutletBusinessController;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.model.SimEmployee;
import com.fern.simulator.model.SimOutlet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * Phase 3: Manages the workforce lifecycle — hiring founding staff,
 * monthly turnover, replacement scheduling, and role assignment.
 */
public class WorkforcePhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(WorkforcePhase.class);

    private static final String[][] EMPLOYEE_NAMES = {
            {"Nguyen", "Van", "An"}, {"Tran", "Thi", "Bich"}, {"Le", "Hoang", "Cuong"},
            {"Pham", "Minh", "Duc"}, {"Vo", "Ngoc", "Em"}, {"Dang", "Quoc", "Phong"},
            {"Bui", "Thanh", "Giang"}, {"Hoang", "Hai", "Ha"}, {"Huynh", "Duc", "Khang"},
            {"Ngo", "Anh", "Linh"}, {"Do", "Bao", "Minh"}, {"Ly", "Kim", "Ngan"},
            {"Duong", "Chi", "Oanh"}, {"Truong", "Dinh", "Phuc"}, {"Mai", "Tuan", "Quang"},
            {"Lam", "Thi", "Rung"}, {"Dinh", "Hong", "Son"}, {"Luong", "Cam", "Tien"},
            {"Trinh", "Viet", "Ung"}, {"Ha", "Xuan", "Van"}
    };

    private static final String[] GENDERS = {"male", "female"};
    private static final int STARTUP_GRACE_DAYS = 45;
    private static final int MATURE_STAFF_FLOOR = 2;
    private static final long TARGET_MONTHLY_REVENUE_PER_EMPLOYEE = 18_000_000L;
    private static final int TARGET_MONTHLY_SALES_PER_EMPLOYEE = 230;
    private static final int MAX_MONTHLY_RIGHTSIZE = 3;
    private static final double STRESS_BUFFER_THRESHOLD = 1.6;
    private static final int LATE_DELIVERY_BUFFER_THRESHOLD = 4;
    private static final double PART_TIME_MONTHLY_HOURS = 96.0;

    @Override
    public String name() { return "Workforce"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        // Process pending replacements that are due today
        processPendingReplacements(ctx, day);

        // Staff outlets that opened today
        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            if (outlet.getOpenedDate().equals(day)) {
                hireFoundingStaff(ctx, outlet, day);
            }
        }

        evaluateDailyDisruptions(ctx, day);
        stabilizeUnderstaffedOutlets(ctx, day);

        // Monthly turnover evaluation on 1st of month
        if (day.getDayOfMonth() == 1 && !day.equals(ctx.getConfig().startDate())) {
            evaluateTurnover(ctx, day);
            evaluateRightSizing(ctx, day);
            evaluateAdditionalHiring(ctx, day);
        }
    }

    private void hireFoundingStaff(SimulationContext ctx, SimOutlet outlet, LocalDate day) {
        int foundingCount = ctx.getConfig().probability().foundingStaffPerOutlet();
        boolean sharedSatellite = ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()) > 1
                && outlet.getServiceSlotCount() <= 38;
        int hires = 0;

        // Lean VN quick-service sites open with a small core, then layer peak-hour flex coverage.
        if (!sharedSatellite) {
            hireEmployee(ctx, outlet, day, "outlet_manager");
            hires++;
        }
        if (sharedSatellite || foundingCount >= 2) {
            hireEmployee(ctx, outlet, day, "kitchen_staff");
            hires++;
        }
        if (sharedSatellite || foundingCount >= 3) {
            hireEmployee(ctx, outlet, day, "cashier");
            hires++;
        }

        for (int i = hires; i < foundingCount; i++) {
            String role = pickRole(ctx.getRandom(), ctx.getConfig().probability().roleDistribution());
            hireEmployee(ctx, outlet, day, role);
            hires++;
        }

        outlet.setActiveStaffCount(hires);
        ctx.getCurrentMonth().addHired(hires);
        log.debug("Hired {} founding staff for outlet {} on {}", hires, outlet.getCode(), day);
    }

    private void evaluateTurnover(SimulationContext ctx, LocalDate day) {
        SimulationConfig.ProbabilityConfig prob = ctx.getConfig().probability();
        SimulationRandom rng = ctx.getRandom();

        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            List<SimEmployee> activeStaff = ctx.getActiveEmployeesAtOutlet(outlet.getId());

            for (SimEmployee emp : activeStaff) {
                // Skip if they just started (less than 30 days)
                if (emp.getHireDate().plusDays(30).isAfter(day)) continue;

                if (rng.chance(prob.monthlyTurnoverRate())) {
                    // Determine departure type
                    String newUserStatus;
                    if (rng.chance(prob.suspensionChance())) {
                        newUserStatus = "suspended";
                    } else {
                        newUserStatus = "inactive";
                    }

                    StatusTransitions.validate(StatusTransitions.USER, "User",
                            emp.getUserStatus(), newUserStatus);
                    StatusTransitions.validate(StatusTransitions.CONTRACT, "Contract",
                            emp.getContractStatus(), "terminated");

                    emp.setUserStatus(newUserStatus);
                    emp.setContractStatus("terminated");
                    emp.setTerminationDate(day);
                    ctx.markEmployeeDirty(emp);
                    ctx.recordQuit();

                    outlet.setActiveStaffCount(outlet.getActiveStaffCount() - 1);
                    ctx.getCurrentMonth().addDeparted();

                    // Schedule replacement
                    int remainingStaff = Math.max(0, ctx.getActiveEmployeesAtOutlet(outlet.getId()).size() - 1);
                    if (rng.chance(prob.replacementChance()) && needsReplacement(ctx, outlet, day, remainingStaff)) {
                        LocalDate replacementDate = day.plusDays(prob.replacementLagDays());
                        ctx.addPendingReplacement(new SimulationContext.PendingReplacement(
                                outlet.getId(), outlet.getRegionCode(),
                                emp.getRoleCode(), replacementDate));
                        emp.setScheduledReplacementDate(replacementDate);
                    }

                    log.debug("Employee {} departed ({}) from outlet {} on {}",
                            emp.getEmployeeCode(), newUserStatus, outlet.getCode(), day);
                }
            }
        }
    }

    private void evaluateAdditionalHiring(SimulationContext ctx, LocalDate day) {
        SimulationConfig.ProbabilityConfig prob = ctx.getConfig().probability();
        SimulationRandom rng = ctx.getRandom();

        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            int currentStaff = ctx.getActiveEmployeesAtOutlet(outlet.getId()).size();
            int desiredStaff = desiredStaffLevel(ctx, outlet, day);
            if (currentStaff < desiredStaff && rng.chance(prob.hiringChancePerMonth())) {
                String role = preferredOperationalRole(ctx, outlet, rng, prob.roleDistribution());
                hireEmployee(ctx, outlet, day, role);
                outlet.setActiveStaffCount(currentStaff + 1);
                ctx.getCurrentMonth().addHired(1);
                log.debug("Additional hire at outlet {} on {}, role={}", outlet.getCode(), day, role);
            }
        }
    }

    private void evaluateRightSizing(SimulationContext ctx, LocalDate day) {
        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            List<SimEmployee> activeStaff = new ArrayList<>(ctx.getActiveEmployeesAtOutlet(outlet.getId()));
            int desiredStaff = desiredStaffLevel(ctx, outlet, day);
            int excess = activeStaff.size() - desiredStaff;
            if (excess <= 0) {
                outlet.setActiveStaffCount(activeStaff.size());
                continue;
            }

            int reductions = 0;
            List<SimEmployee> retained = new ArrayList<>(activeStaff);
            List<SimEmployee> candidates = activeStaff.stream()
                    .sorted(Comparator.comparingInt(this::downsizingPriority)
                            .thenComparing(Comparator.comparingLong(SimEmployee::getBaseSalary).reversed())
                            .thenComparingDouble(SimEmployee::getDisciplineScore)
                            .thenComparing(Comparator.comparingDouble(SimEmployee::getFatigueScore).reversed()))
                    .toList();

            for (SimEmployee candidate : candidates) {
                if (reductions >= Math.min(MAX_MONTHLY_RIGHTSIZE, excess)) {
                    break;
                }
                if (!canRightSize(retained, candidate)) {
                    continue;
                }

                StatusTransitions.validate(StatusTransitions.USER, "User",
                        candidate.getUserStatus(), "inactive");
                StatusTransitions.validate(StatusTransitions.CONTRACT, "Contract",
                        candidate.getContractStatus(), "terminated");

                candidate.setUserStatus("inactive");
                candidate.setContractStatus("terminated");
                candidate.setTerminationDate(day);
                candidate.setScheduledReplacementDate(null);
                ctx.markEmployeeDirty(candidate);
                retained.remove(candidate);
                reductions++;
                ctx.getCurrentMonth().addDeparted();
            }

            outlet.setActiveStaffCount(retained.size());
            if (reductions > 0) {
                log.debug("Right-sized outlet {} on {}, removed {} staff (desired={})",
                        outlet.getCode(), day, reductions, desiredStaff);
            }
        }
    }

    private void processPendingReplacements(SimulationContext ctx, LocalDate day) {
        var iter = ctx.getPendingReplacements().iterator();
        while (iter.hasNext()) {
            var pending = iter.next();
            if (!day.isBefore(pending.scheduledDate())) {
                SimOutlet outlet = ctx.getOutlets().get(pending.outletId());
                if (outlet != null && outlet.isActive()) {
                    int currentStaff = ctx.getActiveEmployeesAtOutlet(outlet.getId()).size();
                    int desiredStaff = desiredStaffLevel(ctx, outlet, day);
                    if (currentStaff >= desiredStaff) {
                        iter.remove();
                        continue;
                    }
                    String role = pending.roleCode() != null
                            ? pending.roleCode()
                            : preferredOperationalRole(ctx, outlet, ctx.getRandom(), ctx.getConfig().probability().roleDistribution());
                    hireEmployee(ctx, outlet, day, role);
                    outlet.setActiveStaffCount(currentStaff + 1);
                    ctx.getCurrentMonth().addHired(1);
                    ctx.recordReplacement();
                    log.debug("Replacement hire at outlet {} on {}, role={}", outlet.getCode(), day, role);
                }
                iter.remove();
            }
        }
    }

    private void evaluateDailyDisruptions(SimulationContext ctx, LocalDate day) {
        SimulationRandom rng = ctx.getRandom();
        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            for (SimEmployee emp : List.copyOf(ctx.getActiveEmployeesAtOutlet(outlet.getId()))) {
                if (emp.getHireDate().plusDays(10).isAfter(day)) {
                    continue;
                }

                double fatiguePressure = emp.getFatigueScore() * 0.0018 + outlet.getAttendanceStressScore() * 0.0012;
                double quitChance = 0.00035 + fatiguePressure;
                double suspendChance = 0.00015
                        + ctx.getConfig().probability().suspensionChance() * 0.01
                        + Math.max(0, 0.0014 - emp.getDisciplineScore() * 0.001);

                if (rng.chance(Math.min(0.0045, quitChance))) {
                    emp.setUserStatus("inactive");
                    emp.setContractStatus("terminated");
                    emp.setTerminationDate(day);
                    emp.setScheduledReplacementDate(day.plusDays(ctx.getConfig().probability().replacementLagDays()));
                    ctx.markEmployeeDirty(emp);
                    int remainingStaff = Math.max(0, ctx.getActiveEmployeesAtOutlet(outlet.getId()).size() - 1);
                    if (needsReplacement(ctx, outlet, day, remainingStaff)) {
                        ctx.addPendingReplacement(new SimulationContext.PendingReplacement(
                                outlet.getId(), outlet.getRegionCode(), emp.getRoleCode(), emp.getScheduledReplacementDate()));
                    }
                    outlet.setActiveStaffCount(remainingStaff);
                    ctx.getCurrentMonth().addDeparted();
                    ctx.recordQuit();
                    continue;
                }

                if (rng.chance(Math.min(0.003, suspendChance))) {
                    emp.setUserStatus("suspended");
                    emp.setContractStatus("terminated");
                    emp.setTerminationDate(day);
                    emp.setScheduledReplacementDate(day.plusDays(Math.max(3, ctx.getConfig().probability().replacementLagDays() / 2)));
                    ctx.markEmployeeDirty(emp);
                    int remainingStaff = Math.max(0, ctx.getActiveEmployeesAtOutlet(outlet.getId()).size() - 1);
                    if (needsReplacement(ctx, outlet, day, remainingStaff)) {
                        ctx.addPendingReplacement(new SimulationContext.PendingReplacement(
                                outlet.getId(), outlet.getRegionCode(), emp.getRoleCode(), emp.getScheduledReplacementDate()));
                    }
                    outlet.setActiveStaffCount(remainingStaff);
                    ctx.getCurrentMonth().addDeparted();
                    ctx.recordQuit();
                }
            }
        }
    }

    private void stabilizeUnderstaffedOutlets(SimulationContext ctx, LocalDate day) {
        SimulationRandom rng = ctx.getRandom();
        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            int currentStaff = ctx.getActiveEmployeesAtOutlet(outlet.getId()).size();
            int desiredStaff = desiredStaffLevel(ctx, outlet, day);
            boolean emergency = currentStaff < Math.max(2, desiredStaff - 1) || outlet.getAttendanceStressScore() >= 1.8;
            if (!emergency || currentStaff >= desiredStaff) {
                continue;
            }
            String role = currentStaff == 0
                    ? "cashier"
                    : preferredOperationalRole(ctx, outlet, rng, ctx.getConfig().probability().roleDistribution());
            hireEmployee(ctx, outlet, day, role);
            outlet.setActiveStaffCount(currentStaff + 1);
            ctx.getCurrentMonth().addHired(1);
            ctx.recordReplacement();
        }
    }

    private void hireEmployee(SimulationContext ctx, SimOutlet outlet, LocalDate day, String roleCode) {
        SimulationRandom rng = ctx.getRandom();
        long userId = ctx.getIdGen().nextId();
        long contractId = ctx.getIdGen().nextId();
        String empCode = ctx.nextEmployeeCode();

        String[] nameParts = EMPLOYEE_NAMES[rng.intBetween(0, EMPLOYEE_NAMES.length - 1)];
        String fullName = nameParts[0] + " " + nameParts[1] + " " + nameParts[2];
        String username = empCode.toLowerCase().replace("-", "_");
        String gender = GENDERS[rng.intBetween(0, 1)];

        String regionCode = RegionalEconomics.marketCode(outlet);
        long recentRevenue = Math.max(averageRecentRevenue(outlet), OutletBusinessController.revenueRunRate(outlet, day));
        int recentSales = Math.max(averageRecentSales(outlet), OutletBusinessController.salesRunRate(outlet, day));
        long baseSalary = RegionalEconomics.salaryForRole(
                regionCode,
                ctx.getConfig().startDate(),
                day,
                roleCode,
                recentRevenue,
                recentSales,
                rng.doubleBetween(0.94, 1.08));
        baseSalary = RegionalEconomics.adjustSalaryOffer(baseSalary, regionCode, outlet.getDynamicWageMultiplier());
        String currency = RegionalEconomics.currencyFor(regionCode);
        EmploymentTerms employmentTerms = determineEmploymentTerms(ctx, outlet, roleCode, recentRevenue, recentSales);
        if ("hourly".equals(employmentTerms.salaryType())) {
            baseSalary = RegionalEconomics.hourlyWageForRole(regionCode, roleCode, outlet.getDynamicWageMultiplier());
        }

        String actualRole = "employee_no_role".equals(roleCode) ? null : roleCode;
        double attendanceReliability = Math.min(0.99, Math.max(0.78, rng.gaussian(0.93, 0.05)));
        double fatigue = Math.max(0.0, rng.doubleBetween(0.0, 0.4));
        double discipline = Math.min(0.98, Math.max(0.60, rng.gaussian(0.82, 0.08)));

        SimEmployee emp = new SimEmployee(userId, contractId, empCode, username,
                fullName, gender, outlet.getId(), regionCode, actualRole,
                day, baseSalary, currency, employmentTerms.employmentType(), employmentTerms.salaryType(),
                attendanceReliability, fatigue, discipline);

        ctx.addEmployee(emp);
    }

    private String pickRole(SimulationRandom rng, Map<String, Double> distribution) {
        if (distribution == null || distribution.isEmpty()) return "cashier";
        return rng.pickWeighted(distribution);
    }

    private boolean needsReplacement(SimulationContext ctx, SimOutlet outlet, LocalDate day, int remainingStaff) {
        return remainingStaff + pendingReplacementCount(ctx, outlet.getId()) < desiredStaffLevel(ctx, outlet, day);
    }

    private int pendingReplacementCount(SimulationContext ctx, long outletId) {
        return (int) ctx.getPendingReplacements().stream()
                .filter(pending -> pending.outletId() == outletId)
                .count();
    }

    private int desiredStaffLevel(SimulationContext ctx, SimOutlet outlet, LocalDate day) {
        SimulationConfig.ProbabilityConfig prob = ctx.getConfig().probability();
        long daysOpen = Math.max(0, ChronoUnit.DAYS.between(outlet.getOpenedDate(), day));
        boolean supportedByPeer = ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()) > 1;
        int startupFloor = supportedByPeer && outlet.getServiceSlotCount() <= 38 ? 2 : 3;
        int staffingFloor = daysOpen < STARTUP_GRACE_DAYS
                ? Math.max(startupFloor, Math.min(prob.foundingStaffPerOutlet(), startupFloor + 1))
                : MATURE_STAFF_FLOOR;
        long recentRevenue = averageRecentRevenue(outlet);
        int recentSales = averageRecentSales(outlet);
        recentRevenue = Math.max(recentRevenue, OutletBusinessController.revenueRunRate(outlet, day));
        recentSales = Math.max(recentSales, OutletBusinessController.salesRunRate(outlet, day));
        double networkProductivity = supportedByPeer
                ? clamp(1.02 + Math.max(0.0, outlet.getReputationScore() - 0.98) * 0.08, 1.00, 1.10)
                : 1.0;
        long revenuePerEmployeeTarget = Math.round(TARGET_MONTHLY_REVENUE_PER_EMPLOYEE * networkProductivity);
        int salesPerEmployeeTarget = Math.max(190, (int) Math.round(TARGET_MONTHLY_SALES_PER_EMPLOYEE * networkProductivity));
        int revenueDriven = recentRevenue <= 0
                ? 0
                : (int) Math.ceil((double) recentRevenue / Math.max(1L, revenuePerEmployeeTarget));
        int salesDriven = recentSales <= 0
                ? 0
                : (int) Math.ceil((double) recentSales / salesPerEmployeeTarget);
        int seatDriven = Math.max(0, (int) Math.ceil(outlet.getServiceSlotCount() / 18.0) - 1);
        long payrollRunRate = estimateMonthlyPayrollRunRate(ctx.getActiveEmployeesAtOutlet(outlet.getId()));
        OutletEconomicsModel.Snapshot economics = OutletEconomicsModel.snapshot(outlet);
        double laborShare = recentRevenue <= 0
                ? 0.24
                : payrollRunRate / (double) Math.max(1L, recentRevenue);
        int demandBuffer = outlet.getRollingCapacityPressure() > 1.08
                && outlet.getRollingThroughputUtilization() > 0.78
                && outlet.getRollingServiceLossRate() > 0.10
                && laborShare < 0.34
                && outlet.getRollingStockoutLossRate() < 0.14 ? 1 : 0;
        if (outlet.getRollingCapacityPressure() > 1.24
                && outlet.getRollingServiceLossRate() > 0.20
                && laborShare < 0.36) {
            demandBuffer++;
        }
        int queueBuffer = economics.serviceSlotUtilization() >= 0.70
                && economics.serviceLostPct() >= 0.12
                && economics.contributionMarginPct() >= 0.12
                && laborShare < 0.34 ? 1 : 0;
        if (economics.serviceSlotUtilization() >= 0.88
                && economics.serviceLostPct() >= 0.18
                && economics.contributionMarginPct() >= 0.15
                && laborShare < 0.36) {
            queueBuffer++;
        }
        int stockBuffer = economics.stockoutLostPct() >= 0.16
                && economics.contributionMarginPct() >= 0.13
                && economics.wastePct() <= 0.13 ? 1 : 0;
        if (economics.stockoutLostPct() >= 0.24
                && economics.contributionMarginPct() >= 0.16
                && economics.wastePct() <= 0.15) {
            stockBuffer++;
        }
        int peakFlexBuffer = economics.serviceSlotUtilization() >= 0.78
                && economics.serviceLostPct() >= 0.12
                && laborShare < 0.34 ? 1 : 0;
        if (economics.serviceSlotUtilization() >= 0.92
                && economics.serviceLostPct() >= 0.18
                && outlet.getReputationScore() >= 1.00
                && laborShare < 0.34) {
            peakFlexBuffer++;
        }
        if (economics.serviceSlotUtilization() >= 0.98
                && economics.serviceLostPct() >= 0.24
                && laborShare < 0.38) {
            peakFlexBuffer++;
        }
        int marginGuardrail = laborShare > 0.34
                && economics.contributionMarginPct() < 0.10
                && economics.serviceSlotUtilization() < 0.66
                && outlet.getRollingCapacityPressure() < 0.96
                && outlet.getRollingServiceLossRate() < 0.07 ? -1 : 0;
        int operationalBuffer = outlet.getAttendanceStressScore() >= STRESS_BUFFER_THRESHOLD
                || outlet.getLateDeliveryCount30d() >= LATE_DELIVERY_BUFFER_THRESHOLD ? 1 : 0;

        if (supportedByPeer && outlet.getServiceSlotCount() <= 38 && economics.serviceSlotUtilization() < 0.70) {
            peakFlexBuffer = Math.max(0, peakFlexBuffer - 1);
        }

        int lostSalesPressureBuffer = economics.totalLostPct() >= 0.30
                && economics.serviceSlotUtilization() >= 0.58 ? 1 : 0;
        if (economics.totalLostPct() >= 0.40
                && economics.serviceSlotUtilization() >= 0.66
                && laborShare < 0.40) {
            lostSalesPressureBuffer++;
        }
        if (outlet.getRollingCapacityPressure() >= 1.18
                && outlet.getRollingServiceLossRate() >= 0.12
                && laborShare < 0.40) {
            lostSalesPressureBuffer++;
        }

        int desired = Math.max(staffingFloor, Math.max(seatDriven, Math.max(revenueDriven, salesDriven)))
                + operationalBuffer + demandBuffer + queueBuffer + stockBuffer + peakFlexBuffer
                + lostSalesPressureBuffer + marginGuardrail;
        int dynamicMaxStaff = prob.maxStaffPerOutlet();
        if (economics.totalLostPct() >= 0.30 || outlet.getRollingCapacityPressure() >= 1.16) {
            dynamicMaxStaff = Math.max(dynamicMaxStaff, 16);
        }
        if (economics.totalLostPct() >= 0.42 && outlet.getRollingServiceLossRate() >= 0.14) {
            dynamicMaxStaff = Math.max(dynamicMaxStaff, 18);
        }
        if (economics.totalLostPct() >= 0.50
                && outlet.getRollingCapacityPressure() >= 1.18
                && economics.serviceSlotUtilization() >= 0.68) {
            dynamicMaxStaff = Math.max(dynamicMaxStaff, 22);
        }
        return Math.max(MATURE_STAFF_FLOOR, Math.min(dynamicMaxStaff, desired));
    }

    private String preferredOperationalRole(SimulationContext ctx, SimOutlet outlet, SimulationRandom rng,
                                            Map<String, Double> distribution) {
        List<SimEmployee> staff = ctx.getActiveEmployeesAtOutlet(outlet.getId());
        long managerCount = staff.stream().filter(emp -> "outlet_manager".equals(emp.getRoleCode())).count();
        long cashierCount = staff.stream().filter(emp -> "cashier".equals(emp.getRoleCode())).count();
        long kitchenCount = staff.stream().filter(emp -> "kitchen_staff".equals(emp.getRoleCode())).count();
        long inventoryCount = staff.stream().filter(emp -> "inventory_clerk".equals(emp.getRoleCode())).count();
        OutletEconomicsModel.Snapshot economics = OutletEconomicsModel.snapshot(outlet);
        boolean sharedSatellite = ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()) > 1
                && outlet.getServiceSlotCount() <= 38
                && ChronoUnit.DAYS.between(outlet.getOpenedDate(), ctx.getClock().getCurrentDate()) < 120;

        if (managerCount == 0 && !sharedSatellite) {
            return "outlet_manager";
        }
        if (economics.serviceSlotUtilization() >= 0.72 && cashierCount <= 1) {
            return "cashier";
        }
        if (economics.serviceLostPct() >= economics.stockoutLostPct() * 0.90 && kitchenCount <= cashierCount + 1) {
            return "kitchen_staff";
        }
        if ((economics.stockoutLostPct() >= 0.14 || outlet.getLateDeliveryCount30d() >= 2) && inventoryCount == 0) {
            return "inventory_clerk";
        }
        return pickRole(rng, distribution);
    }

    private long averageRecentRevenue(SimOutlet outlet) {
        if (!outlet.getMonthlyRevenue().isEmpty()) {
            return Math.round(outlet.getMonthlyRevenue().stream()
                    .skip(Math.max(0, outlet.getMonthlyRevenue().size() - 3L))
                    .mapToLong(Long::longValue)
                    .average()
                    .orElse(0));
        }
        return outlet.getCurrentMonthRevenue();
    }

    private int averageRecentSales(SimOutlet outlet) {
        if (!outlet.getMonthlyCompletedSales().isEmpty()) {
            return (int) Math.round(outlet.getMonthlyCompletedSales().stream()
                    .skip(Math.max(0, outlet.getMonthlyCompletedSales().size() - 3L))
                    .mapToInt(Integer::intValue)
                    .average()
                    .orElse(0));
        }
        return outlet.getCurrentMonthCompletedSales();
    }

    private long estimateMonthlyPayrollRunRate(List<SimEmployee> activeStaff) {
        return activeStaff.stream()
                .mapToLong(this::monthlyPayrollEquivalent)
                .sum();
    }

    private long monthlyPayrollEquivalent(SimEmployee employee) {
        long localized = "hourly".equals(employee.getSalaryType())
                ? Math.round(employee.getBaseSalary() * PART_TIME_MONTHLY_HOURS)
                : employee.getBaseSalary();
        return RegionalEconomics.convertToReportingCurrency(localized, employee.getCurrencyCode());
    }

    private EmploymentTerms determineEmploymentTerms(SimulationContext ctx, SimOutlet outlet, String roleCode,
                                                     long recentRevenue, int recentSales) {
        List<SimEmployee> staff = ctx.getActiveEmployeesAtOutlet(outlet.getId());
        long roleCount = staff.stream()
                .filter(emp -> roleCode.equals(emp.getRoleCode()))
                .count();
        long daysOpen = Math.max(0, ChronoUnit.DAYS.between(outlet.getOpenedDate(), ctx.getClock().getCurrentDate()));
        boolean strongOutlet = recentRevenue >= 120_000_000L || recentSales >= 1400;
        boolean peakHeavyOutlet = outlet.getServiceSlotCount() >= 38
                || outlet.getRollingCapacityPressure() > 1.04
                || outlet.getRollingThroughputUtilization() > 0.78;
        boolean supportedByPeer = ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()) > 1;
        boolean sharedSatellite = supportedByPeer && daysOpen < 120 && outlet.getServiceSlotCount() <= 38;

        if ("outlet_manager".equals(roleCode)) {
            return sharedSatellite
                    ? new EmploymentTerms("part_time", "hourly")
                    : new EmploymentTerms("full_time", "monthly");
        }
        if ("inventory_clerk".equals(roleCode)) {
            return roleCount == 0 && strongOutlet
                    && (outlet.getRollingStockoutLossRate() >= 0.08 || outlet.getLateDeliveryCount30d() >= 2)
                    ? new EmploymentTerms("full_time", "monthly")
                    : new EmploymentTerms("part_time", "hourly");
        }
        if ("kitchen_staff".equals(roleCode)) {
            return roleCount == 0 && !sharedSatellite
                    ? new EmploymentTerms("full_time", "monthly")
                    : new EmploymentTerms("part_time", "hourly");
        }
        if ("cashier".equals(roleCode)) {
            if (roleCount == 0 && supportedByPeer && daysOpen < 90 && outlet.getServiceSlotCount() <= 38) {
                return new EmploymentTerms("part_time", "hourly");
            }
            return roleCount == 0
                    ? new EmploymentTerms("full_time", "monthly")
                    : new EmploymentTerms("part_time", "hourly");
        }
        return new EmploymentTerms("part_time", "hourly");
    }

    private boolean canRightSize(List<SimEmployee> retained, SimEmployee candidate) {
        if (retained.size() <= MATURE_STAFF_FLOOR) {
            return false;
        }

        long remainingManagers = retained.stream()
                .filter(emp -> emp != candidate)
                .filter(emp -> "outlet_manager".equals(emp.getRoleCode()))
                .count();
        long remainingFrontline = retained.stream()
                .filter(emp -> emp != candidate)
                .filter(this::isFrontlineRole)
                .count();

        if ("outlet_manager".equals(candidate.getRoleCode()) && remainingManagers == 0) {
            return false;
        }
        return !isFrontlineRole(candidate) || remainingFrontline > 0;
    }

    private boolean isFrontlineRole(SimEmployee employee) {
        return "cashier".equals(employee.getRoleCode()) || "outlet_manager".equals(employee.getRoleCode());
    }

    private int downsizingPriority(SimEmployee employee) {
        if ("hourly".equals(employee.getSalaryType()) || "part_time".equals(employee.getEmploymentType())) {
            return -1;
        }
        String roleCode = employee.getRoleCode();
        if (roleCode == null || "employee_no_role".equals(roleCode)) {
            return 0;
        }
        return switch (roleCode) {
            case "inventory_clerk" -> 1;
            case "kitchen_staff" -> 2;
            case "cashier" -> 3;
            case "outlet_manager" -> 4;
            default -> 2;
        };
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private record EmploymentTerms(String employmentType, String salaryType) {}
}
