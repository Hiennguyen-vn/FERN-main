package com.fern.simulator.engine;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.economics.OutletEconomicsModel;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.engine.phases.*;
import com.fern.simulator.model.SimEmployee;
import com.fern.simulator.model.SimOutlet;
import com.fern.simulator.model.RunResult;
import com.fern.simulator.persistence.*;
import com.fern.simulator.render.ProgressRenderer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.sql.Connection;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Day-by-day simulation engine. Processes each simulation day through
 * ordered phase handlers to build causally consistent business data.
 */
public class SimulationEngine {

    private static final Logger log = LoggerFactory.getLogger(SimulationEngine.class);
    private static final ObjectMapper JSON = new ObjectMapper().registerModule(new JavaTimeModule());

    private final List<PhaseHandler> phases;
    private final PayrollPhase payrollPhase;
    private volatile boolean cancelled = false;

    public SimulationEngine() {
        this.payrollPhase = new PayrollPhase();
        this.phases = List.of(
                new ExpansionPhase(),
                new CatalogPhase(),
                new WorkforcePhase(),
                new ProcurementPhase(),
                new ManufacturingPhase(),
                new InventoryPhase(),
                new PromotionPhase(),
                new SalesPhase(),
                new ExpensePhase(),
                payrollPhase
        );
    }

    public void cancel() { this.cancelled = true; }
    public boolean isCancelled() { return cancelled; }

    /** CLI mode — no listener */
    public RunResult run(SimulationConfig config, DatabaseTarget target, boolean dryRun) {
        return run(config, target, dryRun, null, null);
    }

    /** CLI mode with optional Kafka publishing */
    public RunResult run(SimulationConfig config, DatabaseTarget target, boolean dryRun,
                         String kafkaBootstrap) {
        return run(config, target, dryRun, null, kafkaBootstrap, null);
    }

    /** GUI mode — with progress listener */
    public RunResult run(SimulationConfig config, DatabaseTarget target, boolean dryRun,
                         ProgressListener listener) {
        return run(config, target, dryRun, listener, null, null);
    }

    /** Full — with progress listener and optional Kafka publishing */
    public RunResult run(SimulationConfig config, DatabaseTarget target, boolean dryRun,
                         ProgressListener listener, String kafkaBootstrap) {
        return run(config, target, dryRun, listener, kafkaBootstrap, null);
    }

    /** Full — with progress listener, optional Kafka publishing, optional org-service URL for cache eviction */
    public RunResult run(SimulationConfig config, DatabaseTarget target, boolean dryRun,
                         ProgressListener listener, String kafkaBootstrap, String orgServiceUrl) {
        log.info("Starting simulation: namespace={}, seed={}, days={}, dryRun={}",
                config.namespace(), config.seed(), config.totalDays(), dryRun);
        if (listener != null) listener.onStart(config.namespace(), config.totalDays(),
                config.startDate(), config.endDate());

        SimulationContext ctx = new SimulationContext(config, !dryRun);

        // Initialize event journal
        EventJournal journal = null;
        String configHash = String.valueOf(config.hashCode());
        try {
            Path outputDir = Path.of("simulator-output");
            journal = new EventJournal(outputDir, config.namespace(), config.seed(), configHash);
        } catch (IOException e) {
            log.warn("Failed to initialize event journal, continuing without", e);
        }

        // Initialize Kafka publisher if bootstrap provided and not dry-run
        SimulatorKafkaPublisher kafkaPublisher = null;
        if (!dryRun && kafkaBootstrap != null && !kafkaBootstrap.isBlank()) {
            try {
                kafkaPublisher = new SimulatorKafkaPublisher(kafkaBootstrap);
            } catch (Exception e) {
                log.warn("Failed to initialize Kafka publisher, continuing without event publishing: {}", e.getMessage());
            }
        }

        // Initialize persistence if not dry-run
        Connection dbConn = null;
        DayPersister persister = null;
        String runId = null;

        if (!dryRun && target != null) {
            try {
                dbConn = target.getConnection();

                // Validate schema
                SchemaValidator.validate(dbConn);

                // Bootstrap reference data
                BootstrapRepository.bootstrap(dbConn);

                // Clean stale data from any previous run with same namespace
                dbConn.setAutoCommit(false);
                try (var stmt = dbConn.createStatement()) {
                    stmt.execute("SET LOCAL fern.simulator_cleanup = 'on'");
                }
                CleanupRepository.execute(dbConn, config.namespace());
                dbConn.commit();
                dbConn.setAutoCommit(true);
                log.info("Pre-run cleanup complete for namespace {}", config.namespace());

                // Create simulator_run record
                runId = String.valueOf(ctx.getIdGen().nextId());
                String scenarioJson = "{}"; // TODO: serialize config
                SimulatorRunRepository.insertRun(dbConn, runId, config.namespace(),
                        scenarioJson, (int) config.totalDays());

                persister = new DayPersister(dbConn);
                log.info("Database persistence enabled: run_id={}", runId);
            } catch (Exception e) {
                log.error("Failed to initialize database persistence", e);
                throw new RuntimeException("Database initialization failed", e);
            }
        }

        long dayCount = 0;
        long totalDays = config.totalDays();
        ProgressRenderer progress = new ProgressRenderer(totalDays);
        long startNanos = System.nanoTime();
        Map<String, Long> phaseNanos = new LinkedHashMap<>();

        try {
            for (LocalDate day = config.startDate(); !day.isAfter(config.endDate()); day = day.plusDays(1)) {
                if (cancelled) {
                    log.info("Simulation cancelled at day {}", day);
                    if (listener != null) listener.onError("Cancelled by user");
                    break;
                }
                ctx.advanceToDay(day);
                dayCount++;

                // Execute all phase handlers in strict order
                for (PhaseHandler phase : phases) {
                    try {
                        long phaseStart = System.nanoTime();
                        phase.execute(ctx, day);
                        phaseNanos.merge(phase.name(), System.nanoTime() - phaseStart, Long::sum);
                    } catch (Exception e) {
                        log.error("Phase {} failed on day {}: {}", phase.name(), day, e.getMessage(), e);
                        throw e;
                    }
                }

                LocalDate businessDay = day;
                boolean calendarMonthEnd = businessDay.getDayOfMonth() == businessDay.lengthOfMonth() || businessDay.equals(config.endDate());
                if (calendarMonthEnd) {
                    ctx.getOutlets().values().stream()
                            .filter(outlet -> !businessDay.isBefore(outlet.getOpenedDate()))
                            .forEach(SimOutlet::closeMonth);
                }

                // Persist day batch if write enabled
                if (persister != null) {
                    try {
                        persister.persistDay(ctx, day);
                        // Publish Kafka events AFTER DB commit to avoid consumer race condition
                        if (!persister.getLastPersistedOutlets().isEmpty()) {
                            if (kafkaPublisher != null) {
                                kafkaPublisher.publishOutletsCreated(persister.getLastPersistedOutlets());
                            }
                            evictOrgHierarchyCache(orgServiceUrl);
                        }
                    } catch (Exception e) {
                        log.error("Persistence failed on day {}: {}", day, e.getMessage(), e);
                        String detail = e.getMessage();
                        if (detail != null && detail.contains("relation \"core.") && detail.contains("does not exist")) {
                            throw new RuntimeException("Persistence failed on " + day
                                    + " because the simulator schema changed during the run. Re-apply migrations and restart the simulator.", e);
                        }
                        throw new RuntimeException("Persistence failed on " + day, e);
                    }
                } else {
                    // Dry-run: just clear dirty state
                    ctx.clearDirtyState();
                }

                // Fire per-day listener
                if (listener != null) {
                    listener.onDayComplete(dayCount, totalDays, day,
                            ctx.getActiveOutlets().size(),
                            ctx.getActiveEmployees().size(),
                            ctx.getCurrentMonth() != null ? ctx.getCurrentMonth().getRevenue() : 0,
                            ctx.getCurrentMonth() != null ? ctx.getCurrentMonth().getSalesCount() : 0,
                            persister != null ? persister.getTotalRowsWritten() : 0);
                    listener.onOperationalSummary(ctx.dailyOperationalSnapshot());
                }

                if (listener != null && ctx.getCurrentMonth() != null && calendarMonthEnd) {
                    var m = ctx.getCurrentMonth();
                    listener.onMonthEnd(day.getYear(), day.getMonthValue(),
                            m.getRevenue(), ctx.getActiveOutlets().size(),
                            ctx.getActiveEmployees().size(),
                            m.getSalesCount(), m.getPoCount(),
                            m.getCogs(), m.getPayrollCost(), m.getOperatingCost(),
                            m.getGrossProfit(), m.getNetProfit(),
                            m.getWasteCost(), m.getLostSalesValue());
                }

                // Update progress every 30 days
                if (dayCount % 30 == 0 || dayCount == totalDays) {
                    long monthRevenue = ctx.getCurrentMonth() != null ? ctx.getCurrentMonth().getRevenue() : 0;

                    if (listener == null) {
                        if (System.console() != null) {
                            progress.update(dayCount, day.toString(),
                                    ctx.getActiveOutlets().size(),
                                    ctx.getActiveEmployees().size(), monthRevenue);
                        } else {
                            log.info("Progress: day {}/{} ({}) — {} outlets, {} employees, revenue: {}",
                                    dayCount, totalDays, day,
                                    ctx.getActiveOutlets().size(),
                                    ctx.getActiveEmployees().size(), monthRevenue);
                        }
                    }

                    // Update DB run progress
                    if (dbConn != null && runId != null && dayCount % 90 == 0) {
                        try {
                            SimulatorRunRepository.updateProgress(dbConn, runId,
                                    (int) dayCount, toJson(Map.of(
                                            "date", day.toString(),
                                            "rowsWritten", persister != null ? persister.getTotalRowsWritten() : 0,
                                            "elapsedMs", (System.nanoTime() - startNanos) / 1_000_000L,
                                            "activeOutlets", ctx.getActiveOutlets().size(),
                                            "activeEmployees", ctx.getActiveEmployees().size()
                                    )));
                        } catch (Exception e) {
                            log.warn("Failed to update run progress", e);
                        }
                    }

                    if (journal != null) journal.flush();
                }
            }

            // Finalize
            payrollPhase.accrueFinalMonthIfNeeded(ctx, config.endDate());
            ctx.finalize(ctx.getCurrentMonth());

            List<Map<String, Object>> outletEconomics = buildOutletEconomics(ctx);
            RunResult result = new RunResult(
                    config.seed(),
                    ctx.getRowCounts(),
                    ctx.getAllMonths(),
                    ctx.getAllEmployees().size(),
                    ctx.getActiveEmployees().size(),
                    ctx.getOutlets().size(),
                    ctx.getActiveOutlets().size(),
                    ctx.getAllMonths().stream().mapToLong(m -> m.getRevenue()).sum(),
                    journal != null ? journal.getFilePath().toString() : null,
                    outletEconomics
            );
            Map<String, Object> diagnostics = buildDiagnostics(startNanos, phaseNanos, persister);
            diagnostics.put("realism", buildRealismSummary(ctx));

            // Mark run as complete
            if (dbConn != null && runId != null) {
                try {
                    Map<String, Object> resultJson = new LinkedHashMap<>();
                    resultJson.put("rows", persister != null ? persister.getTotalRowsWritten() : 0);
                    resultJson.put("totalOutlets", result.totalOutletsEver());
                    resultJson.put("activeOutlets", result.activeOutletsAtEnd());
                    resultJson.put("totalEmployees", result.totalEmployeesEver());
                    resultJson.put("activeEmployees", result.activeEmployeesAtEnd());
                    resultJson.put("totalRevenue", result.totalRevenue());
                    resultJson.put("months", result.months().stream().map(month -> {
                        Map<String, Object> monthData = new LinkedHashMap<>();
                        monthData.put("period", "%d-%02d".formatted(month.getYear(), month.getMonth()));
                        monthData.put("revenue", month.getRevenue());
                        monthData.put("sales", month.getSalesCount());
                        monthData.put("cogs", month.getCogs());
                        monthData.put("payrollCost", month.getPayrollCost());
                        monthData.put("operatingCost", month.getOperatingCost());
                        monthData.put("wasteCost", month.getWasteCost());
                        monthData.put("lostSalesValue", month.getLostSalesValue());
                        monthData.put("stockoutLostSalesValue", month.getStockoutLostSalesValue());
                        monthData.put("serviceLostSalesValue", month.getServiceLostSalesValue());
                        monthData.put("basketShrinkLostSalesValue", month.getBasketShrinkLostSalesValue());
                        monthData.put("dineInOrders", month.getDineInOrders());
                        monthData.put("deliveryOrders", month.getDeliveryOrders());
                        monthData.put("avgTicket", month.getSalesCount() <= 0 ? 0.0 : month.getRevenue() / (double) month.getSalesCount());
                        monthData.put("netProfit", month.getNetProfit());
                        monthData.put("expansionEvents", month.getExpansionEvents());
                        return monthData;
                    }).toList());
                    resultJson.put("outletEconomics", outletEconomics);
                    resultJson.put("realism", buildRealismSummary(ctx));
                    resultJson.put("diagnostics", diagnostics);

                    SimulatorRunRepository.completeRun(dbConn, runId, (int) dayCount,
                            toJson(resultJson));
                } catch (Exception e) {
                    log.warn("Failed to mark run as complete", e);
                }
            }

            if (listener == null && System.console() != null) {
                progress.complete();
            }

            if (listener != null) {
                listener.onDiagnostics(diagnostics);
                listener.onComplete(result.rowCounts(), result.totalRevenue(),
                        result.totalEmployeesEver(), result.activeEmployeesAtEnd(),
                        result.totalOutletsEver(), result.activeOutletsAtEnd());
            }

            log.info("Simulation complete: {} days, {} total employees ({} active), {} outlets ({} active){}",
                    dayCount, result.totalEmployeesEver(), result.activeEmployeesAtEnd(),
                    result.totalOutletsEver(), result.activeOutletsAtEnd(),
                    persister != null ? ", " + persister.getTotalRowsWritten() + " rows written" : "");

            return result;

        } catch (Exception e) {
            // Mark run as error
            if (dbConn != null && runId != null) {
                try {
                    SimulatorRunRepository.errorRun(dbConn, runId, e.getMessage());
                } catch (Exception ex) {
                    log.warn("Failed to mark run as error", ex);
                }
            }
            throw e;
        } finally {
            if (kafkaPublisher != null) {
                try { kafkaPublisher.close(); } catch (Exception e) { log.warn("Failed to close Kafka publisher", e); }
            }
            if (journal != null) {
                try { journal.close(); } catch (IOException e) { log.warn("Failed to close journal", e); }
            }
            if (dbConn != null) {
                try { dbConn.close(); } catch (Exception e) { log.warn("Failed to close DB connection", e); }
            }
        }
    }

    private Map<String, Object> buildDiagnostics(long startNanos, Map<String, Long> phaseNanos,
                                                 DayPersister persister) {
        long elapsedMs = (System.nanoTime() - startNanos) / 1_000_000L;
        Map<String, Long> phaseMillis = new LinkedHashMap<>();
        for (var entry : phaseNanos.entrySet()) {
            phaseMillis.put(entry.getKey(), entry.getValue() / 1_000_000L);
        }

        long rowsWritten = persister != null ? persister.getTotalRowsWritten() : 0;
        long rowsPerSecond = elapsedMs > 0 ? Math.round(rowsWritten / (elapsedMs / 1000.0)) : rowsWritten;

        Map<String, Object> diagnostics = new LinkedHashMap<>();
        diagnostics.put("elapsedMs", elapsedMs);
        diagnostics.put("rowsWritten", rowsWritten);
        diagnostics.put("rowsPerSecond", rowsPerSecond);
        diagnostics.put("phaseMs", phaseMillis);
        diagnostics.put("persistMs", persister != null ? persister.getTotalPersistMillis() : 0L);
        diagnostics.put("persistBreakdownMs", persister != null ? persister.getSectionTimingsMillis() : Map.of());
        return diagnostics;
    }

    private List<Map<String, Object>> buildOutletEconomics(SimulationContext ctx) {
        record OutletRow(SimOutlet outlet, OutletEconomicsModel.Snapshot economics, List<SimEmployee> activeEmployees) {}

        List<String> monthLabels = ctx.getAllMonths().stream()
                .map(month -> "%d-%02d".formatted(month.getYear(), month.getMonth()))
                .toList();
        List<OutletRow> outlets = ctx.getOutlets().values().stream()
                .map(outlet -> new OutletRow(outlet, OutletEconomicsModel.snapshot(outlet),
                        ctx.getActiveEmployeesAtOutlet(outlet.getId())))
                .sorted(Comparator
                        .comparingInt((OutletRow row) -> row.economics().netMarginPct() < 0 ? 0 : 1)
                        .thenComparingInt(row -> row.outlet().isClosed() ? 1 : 0)
                        .thenComparingDouble(row -> row.economics().netMarginPct())
                        .thenComparing(Comparator.comparingLong((OutletRow row) -> row.outlet().getTotalRevenue()).reversed())
                        .thenComparing(row -> row.outlet().getCode()))
                .toList();
        long totalRevenue = outlets.stream().mapToLong(row -> row.outlet().getTotalRevenue()).sum();
        long totalCost = outlets.stream().mapToLong(row -> row.outlet().getTotalCost()).sum();

        return outlets.stream().map(row -> {
            SimOutlet outlet = row.outlet();
            OutletEconomicsModel.Snapshot economics = row.economics();
            List<SimEmployee> activeEmployees = row.activeEmployees();
            long fullTimeCount = activeEmployees.stream()
                    .filter(employee -> "monthly".equals(employee.getSalaryType()) || "full_time".equals(employee.getEmploymentType()))
                    .count();
            long partTimeCount = activeEmployees.size() - fullTimeCount;
            long fullTimePayrollRunRate = activeEmployees.stream()
                    .filter(employee -> "monthly".equals(employee.getSalaryType()) || "full_time".equals(employee.getEmploymentType()))
                    .mapToLong(this::monthlyPayrollEquivalent)
                    .sum();
            long partTimePayrollRunRate = activeEmployees.stream()
                    .filter(employee -> !"monthly".equals(employee.getSalaryType()) && !"full_time".equals(employee.getEmploymentType()))
                    .mapToLong(this::monthlyPayrollEquivalent)
                    .sum();
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("code", outlet.getCode());
            data.put("name", outlet.getName());
            data.put("regionCode", outlet.getRegionCode());
            data.put("subregionCode", outlet.getSubregionCode());
            data.put("status", outlet.getStatus());
            data.put("openedDate", outlet.getOpenedDate());
            data.put("closedAt", outlet.getClosedAt());
            data.put("revenue", outlet.getTotalRevenue());
            data.put("cost", outlet.getTotalCost());
            data.put("revenueSharePct", totalRevenue <= 0 ? 0.0 : outlet.getTotalRevenue() * 100.0 / totalRevenue);
            data.put("costSharePct", totalCost <= 0 ? 0.0 : outlet.getTotalCost() * 100.0 / totalCost);
            data.put("cogs", outlet.getTotalCogs());
            data.put("cogsPct", economics.cogsPct() * 100.0);
            data.put("payrollCost", outlet.getTotalPayrollCost());
            data.put("laborPct", economics.laborPct() * 100.0);
            data.put("operatingCost", outlet.getTotalOperatingCost());
            data.put("operatingPct", economics.opexPct() * 100.0);
            data.put("wasteCost", outlet.getTotalWasteCost());
            data.put("wastePct", economics.wastePct() * 100.0);
            data.put("lostSalesValue", outlet.getTotalLostSalesValue());
            data.put("lostSalesPct", outlet.getTotalRevenue() <= 0 ? 0.0 : outlet.getTotalLostSalesValue() * 100.0 / outlet.getTotalRevenue());
            data.put("stockoutLostSalesValue", outlet.getTotalStockoutLostSalesValue());
            data.put("serviceLostSalesValue", outlet.getTotalServiceLostSalesValue());
            data.put("basketShrinkLostSalesValue", outlet.getTotalBasketShrinkLostSalesValue());
            data.put("stockoutPct", economics.stockoutLostPct() * 100.0);
            data.put("serviceLostPct", economics.serviceLostPct() * 100.0);
            data.put("basketShrinkPct", outlet.getTotalRevenue() <= 0 ? 0.0 : outlet.getTotalBasketShrinkLostSalesValue() * 100.0 / outlet.getTotalRevenue());
            data.put("netContribution", outlet.getNetContribution());
            data.put("grossProfit", economics.grossProfit());
            data.put("grossMarginPct", economics.grossMarginPct() * 100.0);
            data.put("storeContribution", economics.storeContribution());
            data.put("contributionMarginPct", economics.contributionMarginPct() * 100.0);
            data.put("netMarginPct", economics.netMarginPct() * 100.0);
            data.put("lossMarginPct", Math.max(0.0, -economics.netMarginPct()) * 100.0);
            data.put("isLossMaking", economics.netMarginPct() < 0.0);
            data.put("averageMonthlyRevenue", economics.averageMonthlyRevenue());
            data.put("averageMonthlyContribution", economics.averageMonthlyContribution());
            data.put("estimatedLaunchCost", economics.estimatedLaunchCost());
            data.put("paybackEstimateMonths", economics.paybackEstimateMonths());
            data.put("viabilityBand", economics.viabilityBand());
            data.put("seatUtilization", economics.seatUtilization() * 100.0);
            data.put("serviceSlotUtilization", economics.serviceSlotUtilization() * 100.0);
            data.put("locationTier", outlet.getLocationTier());
            data.put("areaSqm", outlet.getAreaSqm());
            data.put("seatCount", outlet.getSeatCount());
            data.put("tableCount", outlet.getTableCount());
            data.put("serviceSlotCount", outlet.getServiceSlotCount());
            data.put("baseMonthlyRent", outlet.getBaseMonthlyRent());
            data.put("locationDemandMultiplier", outlet.getLocationDemandMultiplier());
            data.put("affluenceIndex", outlet.getAffluenceIndex());
            data.put("footTrafficIndex", outlet.getFootTrafficIndex());
            data.put("crowdIndex", outlet.getCrowdIndex());
            data.put("dineInShare", outlet.getDineInShare());
            data.put("dineInSharePct", outlet.getDineInShare() * 100.0);
            data.put("deliverySharePct", Math.max(0.0, 100.0 - outlet.getDineInShare() * 100.0));
            data.put("dynamicPriceMultiplier", outlet.getDynamicPriceMultiplier());
            data.put("dynamicWageMultiplier", outlet.getDynamicWageMultiplier());
            data.put("rollingCapacityPressure", outlet.getRollingCapacityPressure());
            data.put("rollingServiceLossRate", outlet.getRollingServiceLossRate());
            data.put("rollingStockoutLossRate", outlet.getRollingStockoutLossRate());
            data.put("rollingThroughputUtilization", outlet.getRollingThroughputUtilization());
            data.put("activeFullTimeEmployees", fullTimeCount);
            data.put("activePartTimeEmployees", partTimeCount);
            data.put("fullTimePayrollRunRate", fullTimePayrollRunRate);
            data.put("partTimePayrollRunRate", partTimePayrollRunRate);
            long totalOrders = outlet.getMonthlyCompletedSales().stream().mapToInt(Integer::intValue).sum();
            int activeMonths = Math.max(1, outlet.getMonthlyCompletedSales().size());
            data.put("ordersPerDay", totalOrders / (double) Math.max(1, activeMonths * 30));
            data.put("avgTicket", totalOrders <= 0 ? 0.0 : outlet.getTotalRevenue() / (double) totalOrders);
            data.put("dineInOrders", outlet.getMonthlyDineInOrders().stream().mapToInt(Integer::intValue).sum());
            data.put("deliveryOrders", outlet.getMonthlyDeliveryOrders().stream().mapToInt(Integer::intValue).sum());
            data.put("monthlySeries", buildOutletMonthlySeries(outlet, monthLabels));
            return data;
        }).toList();
    }

    private List<Map<String, Object>> buildOutletMonthlySeries(SimOutlet outlet, List<String> monthLabels) {
        List<Map<String, Object>> series = new ArrayList<>(monthLabels.size());
        String openedMonth = "%d-%02d".formatted(outlet.getOpenedDate().getYear(), outlet.getOpenedDate().getMonthValue());
        int offset = monthLabels.indexOf(openedMonth);
        if (offset < 0) {
            offset = 0;
        }

        List<Long> revenue = outlet.getMonthlyRevenue();
        List<Integer> sales = outlet.getMonthlyCompletedSales();
        List<Long> cogs = outlet.getMonthlyCogs();
        List<Long> payroll = outlet.getMonthlyPayrollCost();
        List<Long> operating = outlet.getMonthlyOperatingCost();
        List<Long> waste = outlet.getMonthlyWasteCost();
        List<Long> lostSales = outlet.getMonthlyLostSalesValue();
        List<Long> stockoutLost = outlet.getMonthlyStockoutLostSalesValue();
        List<Long> serviceLost = outlet.getMonthlyServiceLostSalesValue();
        List<Long> basketShrinkLost = outlet.getMonthlyBasketShrinkLostSalesValue();
        List<Integer> dineInOrders = outlet.getMonthlyDineInOrders();
        List<Integer> deliveryOrders = outlet.getMonthlyDeliveryOrders();

        for (int monthIndex = 0; monthIndex < monthLabels.size(); monthIndex++) {
            int outletIndex = monthIndex - offset;
            long monthRevenue = longSeriesValue(revenue, outletIndex);
            long monthCogs = longSeriesValue(cogs, outletIndex);
            long monthPayroll = longSeriesValue(payroll, outletIndex);
            long monthOperating = longSeriesValue(operating, outletIndex);
            long monthWaste = longSeriesValue(waste, outletIndex);
            long monthLostSales = longSeriesValue(lostSales, outletIndex);
            long monthStockoutLost = longSeriesValue(stockoutLost, outletIndex);
            long monthServiceLost = longSeriesValue(serviceLost, outletIndex);
            long monthBasketShrinkLost = longSeriesValue(basketShrinkLost, outletIndex);
            int monthSales = intSeriesValue(sales, outletIndex);
            int monthDineInOrders = intSeriesValue(dineInOrders, outletIndex);
            int monthDeliveryOrders = intSeriesValue(deliveryOrders, outletIndex);

            Map<String, Object> point = new LinkedHashMap<>();
            point.put("label", monthLabels.get(monthIndex));
            point.put("revenue", monthRevenue);
            point.put("sales", monthSales);
            point.put("cogs", monthCogs);
            point.put("payrollCost", monthPayroll);
            point.put("operatingCost", monthOperating);
            point.put("wasteCost", monthWaste);
            point.put("lostSalesValue", monthLostSales);
            point.put("stockoutLostSalesValue", monthStockoutLost);
            point.put("serviceLostSalesValue", monthServiceLost);
            point.put("basketShrinkLostSalesValue", monthBasketShrinkLost);
            point.put("dineInOrders", monthDineInOrders);
            point.put("deliveryOrders", monthDeliveryOrders);
            point.put("avgTicket", monthSales <= 0 ? 0.0 : monthRevenue / (double) monthSales);
            point.put("netContribution", monthRevenue - monthCogs - monthPayroll - monthOperating - monthWaste);
            point.put("isActiveMonth", outletIndex >= 0 && outletIndex < revenue.size());
            series.add(point);
        }

        return series;
    }

    private long longSeriesValue(List<Long> values, int index) {
        if (index < 0 || index >= values.size()) {
            return 0L;
        }
        return values.get(index);
    }

    private int intSeriesValue(List<Integer> values, int index) {
        if (index < 0 || index >= values.size()) {
            return 0;
        }
        return values.get(index);
    }

    private Map<String, Object> buildRealismSummary(SimulationContext ctx) {
        long wasteEvents = ctx.getAllMonths().stream().mapToLong(month -> month.getWasteEvents()).sum();
        long wasteCost = ctx.getAllMonths().stream().mapToLong(month -> month.getWasteCost()).sum();
        long stockouts = ctx.getAllMonths().stream().mapToLong(month -> month.getStockoutEvents()).sum();
        long lostSalesValue = ctx.getAllMonths().stream().mapToLong(month -> month.getLostSalesValue()).sum();
        long stockoutLostSalesValue = ctx.getAllMonths().stream().mapToLong(month -> month.getStockoutLostSalesValue()).sum();
        long serviceLostSalesValue = ctx.getAllMonths().stream().mapToLong(month -> month.getServiceLostSalesValue()).sum();
        long basketShrinkLostSalesValue = ctx.getAllMonths().stream().mapToLong(month -> month.getBasketShrinkLostSalesValue()).sum();
        long lateDeliveries = ctx.getAllMonths().stream().mapToLong(month -> month.getLateDeliveries()).sum();
        long partialDeliveries = ctx.getAllMonths().stream().mapToLong(month -> month.getPartialDeliveries()).sum();
        long absentShifts = ctx.getAllMonths().stream().mapToLong(month -> month.getAbsentShifts()).sum();
        long lateShifts = ctx.getAllMonths().stream().mapToLong(month -> month.getLateShifts()).sum();
        long overtimeShifts = ctx.getAllMonths().stream().mapToLong(month -> month.getOvertimeShifts()).sum();
        long quits = ctx.getAllMonths().stream().mapToLong(month -> month.getQuits()).sum();
        long replacements = ctx.getAllMonths().stream().mapToLong(month -> month.getReplacements()).sum();

        Map<String, Object> realism = new LinkedHashMap<>();
        realism.put("wasteEvents", wasteEvents);
        realism.put("wasteCost", wasteCost);
        realism.put("stockouts", stockouts);
        realism.put("lostSalesValue", lostSalesValue);
        realism.put("stockoutLostSalesValue", stockoutLostSalesValue);
        realism.put("serviceLostSalesValue", serviceLostSalesValue);
        realism.put("basketShrinkLostSalesValue", basketShrinkLostSalesValue);
        realism.put("lateDeliveries", lateDeliveries);
        realism.put("partialDeliveries", partialDeliveries);
        realism.put("absentShifts", absentShifts);
        realism.put("lateShifts", lateShifts);
        realism.put("overtimeShifts", overtimeShifts);
        realism.put("quits", quits);
        realism.put("replacements", replacements);
        realism.put("carryoverDemand", ctx.getActiveOutlets().stream()
                .mapToLong(outlet -> ctx.totalCarryoverDemand(outlet.getId()))
                .sum());
        return realism;
    }

    private long monthlyPayrollEquivalent(SimEmployee employee) {
        long localized = "hourly".equals(employee.getSalaryType())
                ? Math.round(employee.getBaseSalary() * 96.0)
                : employee.getBaseSalary();
        return RegionalEconomics.convertToReportingCurrency(localized, employee.getCurrencyCode());
    }

    private String toJson(Object value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }

    private void evictOrgHierarchyCache(String orgServiceUrl) {
        if (orgServiceUrl == null || orgServiceUrl.isBlank()) return;
        try {
            HttpClient client = HttpClient.newHttpClient();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(orgServiceUrl.stripTrailing() + "/api/v1/org/cache/evict"))
                    .POST(HttpRequest.BodyPublishers.noBody())
                    .build();
            HttpResponse<Void> response = client.send(request, HttpResponse.BodyHandlers.discarding());
            log.info("Evicted org hierarchy cache: status={}", response.statusCode());
        } catch (Exception e) {
            log.warn("Failed to evict org hierarchy cache (non-fatal): {}", e.getMessage());
        }
    }
}
