package com.fern.simulator.engine.phases;

import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.engine.StatusTransitions;
import com.fern.simulator.economics.OutletEconomicsModel;
import com.fern.simulator.economics.OperationalRealism;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.model.MonthSummary;
import com.fern.simulator.model.SimOutlet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Phase 1: Opens new outlets, handles outlet closures, and triggers region expansion.
 * <p>
 * On the first day, creates the initial outlet(s) in the starting region.
 * On subsequent months (1st of month), evaluates expansion thresholds.
 */
public class ExpansionPhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(ExpansionPhase.class);
    private static final int LOCAL_EXPANSION_COOLDOWN_DAYS = 28;
    private static final int SUBREGION_EXPANSION_COOLDOWN_DAYS = 35;
    private static final int REGION_EXPANSION_COOLDOWN_DAYS = 56;
    private static final double BREAKEVEN_MARGIN_FLOOR = -0.015;
    private static final double STRONG_NET_MARGIN_FLOOR = 0.045;
    private static final double STRONG_CONTRIBUTION_MARGIN_FLOOR = 0.18;

    @Override
    public String name() { return "Expansion"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        SimulationConfig config = ctx.getConfig();

        // --- Bootstrap: first day creates initial outlets ---
        if (day.equals(config.startDate())) {
            bootstrapStartingRegion(ctx, day);
            return;
        }

        // --- Monthly evaluation on 1st of month ---
        if (day.getDayOfMonth() == 1) {
            int closedOutlets = evaluateOutletClosure(ctx, day);
            if (closedOutlets == 0) {
                evaluateAdaptiveGrowth(ctx, day);
            } else {
                log.debug("Skipping growth review on {} because {} outlet(s) closed during the same cycle", day, closedOutlets);
            }
        }
    }

    private void bootstrapStartingRegion(SimulationContext ctx, LocalDate day) {
        SimulationConfig config = ctx.getConfig();
        String startingRegion = config.startingRegion();

        // Find the region config for the starting region
        SimulationConfig.RegionConfig regionConfig = findRegionConfig(config, startingRegion);
        if (regionConfig == null) {
            throw new IllegalStateException("Starting region not found in config: " + startingRegion);
        }

        // Activate region and subregion
        long regionId = ctx.getIdGen().nextId();
        ctx.activateRegion(regionConfig.code(), regionId, day);
        ctx.activateSubregion(startingRegion, day);

        // Create initial outlets only when explicitly configured.
        int initialCount = config.expansion() != null
                ? Math.max(config.expansion().initialOutlets(), 0)
                : 0;
        ZoneId tz = ZoneId.of(regionConfig.timezone());

        if (initialCount == 0) {
            log.info("Bootstrap: no default outlets configured for {}", startingRegion);
            return;
        }

        for (int i = 0; i < initialCount; i++) {
            createOutlet(ctx, day, regionId, regionConfig.code(), startingRegion,
                    "Outlet " + (i + 1) + " - " + startingRegion, tz);
        }

        log.info("Bootstrap: created {} outlet(s) in {}", initialCount, startingRegion);
    }

    private void evaluateAdaptiveGrowth(SimulationContext ctx, LocalDate day) {
        SimulationConfig.ExpansionConfig expansion = ctx.getConfig().expansion();
        if (expansion == null || !expansion.globalExpansionEnabled() || ctx.getActiveOutlets().isEmpty()) {
            return;
        }

        GrowthCandidate flagshipCandidate = findStrategicFlagshipCandidate(ctx, day, expansion);
        if (flagshipCandidate != null && applyGrowthCandidate(ctx, day, flagshipCandidate)) {
            MonthSummary month = ctx.getCurrentMonth();
            if (month != null) {
                month.addExpansionEvent("growthAction", flagshipCandidate.actionType().name().toLowerCase());
                month.addExpansionEvent("growthRegion", flagshipCandidate.regionCode());
                month.addExpansionEvent("growthSubregion", flagshipCandidate.subregionCode());
                month.addExpansionEvent("growthScore", Math.round(flagshipCandidate.score() * 1000.0) / 1000.0);
                month.addExpansionEvent("growthRationale", flagshipCandidate.rationale());
            }
            log.info("Opened {} in {} via {} (score={})",
                    flagshipCandidate.subregionCode(), day,
                    flagshipCandidate.rationale(),
                    Math.round(flagshipCandidate.score() * 1000.0) / 1000.0);
            return;
        }

        ExpansionHealth health = assessExpansionHealth(ctx, expansion);
        if (!health.readyForAnyGrowth()) {
            GrowthCandidate overflowRelief = findOverflowReliefCandidate(ctx, day, false);
            if (overflowRelief != null && applyGrowthCandidate(ctx, day, overflowRelief)) {
                MonthSummary month = ctx.getCurrentMonth();
                if (month != null) {
                    month.addExpansionEvent("growthAction", overflowRelief.actionType().name().toLowerCase());
                    month.addExpansionEvent("growthRegion", overflowRelief.regionCode());
                    month.addExpansionEvent("growthSubregion", overflowRelief.subregionCode());
                    month.addExpansionEvent("growthScore", Math.round(overflowRelief.score() * 1000.0) / 1000.0);
                    month.addExpansionEvent("growthRationale", overflowRelief.rationale());
                }
                log.info("Opened {} in {} via {} (score={})",
                        overflowRelief.subregionCode(), day, overflowRelief.rationale(),
                        Math.round(overflowRelief.score() * 1000.0) / 1000.0);
            }
            return;
        }

        List<GrowthCandidate> candidates = new ArrayList<>();
        collectLocalScaleCandidates(ctx, day, health, candidates);
        collectSubregionCandidates(ctx, day, health, candidates);
        collectRegionCandidates(ctx, day, health, candidates);

        GrowthCandidate choice = candidates.stream()
                .max(Comparator.comparingDouble(GrowthCandidate::score))
                .orElse(null);
        if (choice == null) {
            return;
        }

        if (applyGrowthCandidate(ctx, day, choice)) {
            MonthSummary month = ctx.getCurrentMonth();
            if (month != null) {
                month.addExpansionEvent("growthAction", choice.actionType().name().toLowerCase());
                month.addExpansionEvent("growthRegion", choice.regionCode());
                month.addExpansionEvent("growthSubregion", choice.subregionCode());
                month.addExpansionEvent("growthScore", Math.round(choice.score() * 1000.0) / 1000.0);
                month.addExpansionEvent("growthRationale", choice.rationale());
            }
            log.info("Opened {} in {} via {} (score={})",
                    choice.subregionCode(), day, choice.rationale(), Math.round(choice.score() * 1000.0) / 1000.0);

            boolean canPlaceSecondRelief = health.trailingLostSalesRatio() >= 0.28
                    && ctx.getActiveOutlets().size() >= 3
                    && health.expansionMomentum() >= 0.46;
            if (canPlaceSecondRelief) {
                GrowthCandidate secondaryRelief = findOverflowReliefCandidate(ctx, day, true);
                if (secondaryRelief != null && !secondaryRelief.subregionCode().equals(choice.subregionCode())
                        && applyGrowthCandidate(ctx, day, secondaryRelief)) {
                    MonthSummary current = ctx.getCurrentMonth();
                    if (current != null) {
                        current.addExpansionEvent("growthAction", secondaryRelief.actionType().name().toLowerCase());
                        current.addExpansionEvent("growthRegion", secondaryRelief.regionCode());
                        current.addExpansionEvent("growthSubregion", secondaryRelief.subregionCode());
                        current.addExpansionEvent("growthScore", Math.round(secondaryRelief.score() * 1000.0) / 1000.0);
                        current.addExpansionEvent("growthRationale", secondaryRelief.rationale() + " (secondary)");
                    }
                    log.info("Opened {} in {} via {} (score={})",
                            secondaryRelief.subregionCode(), day,
                            secondaryRelief.rationale() + " (secondary relief)",
                            Math.round(secondaryRelief.score() * 1000.0) / 1000.0);
                }
            }
        }
    }

    private GrowthCandidate findStrategicFlagshipCandidate(SimulationContext ctx, LocalDate day,
                                                           SimulationConfig.ExpansionConfig expansion) {
        List<GrowthCandidate> candidates = new ArrayList<>();
        collectFlagshipLocalScaleCandidates(ctx, day, candidates);
        collectFlagshipSubregionCandidates(ctx, day, expansion, candidates);
        return candidates.stream()
                .max(Comparator.comparingDouble(GrowthCandidate::score))
                .orElse(null);
    }

    private GrowthCandidate findOverflowReliefCandidate(SimulationContext ctx, LocalDate day, boolean bypassCooldown) {
        if (!bypassCooldown && daysSinceLastOutletOpen(ctx, day) < LOCAL_EXPANSION_COOLDOWN_DAYS) {
            return null;
        }
        GrowthCandidate best = null;
        for (String subregionCode : List.copyOf(ctx.getActiveSubregionCodes())) {
            List<SimOutlet> subregionOutlets = ctx.getActiveOutlets().stream()
                    .filter(outlet -> outlet.getSubregionCode().equals(subregionCode))
                    .toList();
            if (subregionOutlets.isEmpty()) {
                continue;
            }
            GroupPerformance performance = summarizePerformance(subregionOutlets);
            boolean overflowCase = performance.totalLostPct() >= 0.14
                    && performance.serviceSlotUtilization() >= 0.54
                    && performance.contributionMarginPct() >= 0.04
                    && performance.wastePct() <= 0.24;
            if (!overflowCase) {
                continue;
            }
            String regionCode = subregionOutlets.getFirst().getRegionCode();
            double score = performance.totalLostPct() * 0.58
                    + Math.max(0.0, performance.serviceSlotUtilization() - 0.56) * 0.62
                    + performance.sitePotential() * 0.20
                    + Math.max(0.0, performance.averageReputation() - 0.95) * 0.24
                    - Math.max(0, subregionOutlets.size() - 1) * 0.030;
            GrowthCandidate candidate = new GrowthCandidate(
                    GrowthActionType.LOCAL_SCALE,
                    regionCode,
                    subregionCode,
                    score,
                    "overflow relief expansion from sustained unmet demand",
                    false,
                    false
            );
            if (best == null || candidate.score() > best.score()) {
                best = candidate;
            }
        }
        return best;
    }

    private int evaluateOutletClosure(SimulationContext ctx, LocalDate day) {
        SimulationConfig config = ctx.getConfig();
        int threshold = config.probability().outletCloseRevenueThresholdPercent();
        int consecutiveMonths = config.probability().outletCloseConsecutiveMonths();
        List<SimOutlet> activeOutlets = List.copyOf(ctx.getActiveOutlets());

        // Calculate average monthly revenue across all active outlets
        long avgRevenue = Math.round(activeOutlets.stream()
                .filter(o -> !o.getMonthlyRevenue().isEmpty())
                .mapToLong(o -> o.getMonthlyRevenue().getLast())
                .average()
                .orElse(0.0));

        if (avgRevenue == 0) return 0;

        long revenueThreshold = avgRevenue * threshold / 100;
        int remainingActive = activeOutlets.size();
        int closedCount = 0;

        for (SimOutlet outlet : List.copyOf(ctx.getActiveOutlets())) {
            if (outlet.getMonthlyRevenue().size() < consecutiveMonths) continue;
            if (ChronoUnit.DAYS.between(outlet.getOpenedDate(), day) < 120) continue;

            // Check if last N months are all below threshold
            List<Long> recent = outlet.getMonthlyRevenue().subList(
                    outlet.getMonthlyRevenue().size() - consecutiveMonths,
                    outlet.getMonthlyRevenue().size());
            List<Integer> recentSales = outlet.getMonthlyCompletedSales().subList(
                    outlet.getMonthlyCompletedSales().size() - consecutiveMonths,
                    outlet.getMonthlyCompletedSales().size());

            boolean allBelow = recent.stream().allMatch(r -> r < revenueThreshold);
            long recentAverageRevenue = Math.round(recent.stream().mapToLong(Long::longValue).average().orElse(0.0));
            double recentAverageSales = recentSales.stream().mapToInt(Integer::intValue).average().orElse(0.0);
            OutletEconomicsModel.Snapshot economics = OutletEconomicsModel.snapshot(outlet);
            boolean sustainedLowDemand = recentAverageRevenue < revenueThreshold && recentAverageSales < 320.0;
            boolean marginBroken = economics.contributionMarginPct() < 0.05
                    || economics.netMarginPct() < -0.18;
            boolean weakUtilization = economics.seatUtilization() < 0.18
                    || economics.serviceSlotUtilization() < 0.30;
            boolean noPayback = economics.paybackEstimateMonths() == null
                    || economics.paybackEstimateMonths() > 48.0;
            boolean operationallyWeak = economics.wastePct() >= 0.12
                    || economics.stockoutLostPct() >= 0.35
                    || economics.serviceLostPct() >= 0.22;

            if (allBelow && sustainedLowDemand && weakUtilization
                    && "distressed".equals(economics.viabilityBand())
                    && (marginBroken || noPayback || operationallyWeak)
                    && remainingActive > 1) {
                StatusTransitions.validate(StatusTransitions.OUTLET, "Outlet",
                        outlet.getStatus(), "closed");
                outlet.setStatus("closed");
                outlet.setClosedAt(ctx.getClock().timestampAt(22, 0,
                        ctx.getTimezoneForRegion(outlet.getRegionCode())));
                ctx.markOutletDirty(outlet);
                remainingActive--;
                closedCount++;

                ctx.getCurrentMonth().addOutletClosed();
                log.info("Closed underperforming outlet {} on {} (recentRevenue={}, contributionMargin={}, netMargin={}, seatUtilization={}, payback={})",
                        outlet.getCode(), day, recentAverageRevenue, economics.contributionMarginPct(),
                        economics.netMarginPct(), economics.seatUtilization(), economics.paybackEstimateMonths());
            }
        }
        return closedCount;
    }

    private void collectLocalScaleCandidates(SimulationContext ctx, LocalDate day,
                                             ExpansionHealth health,
                                             List<GrowthCandidate> candidates) {
        if (!health.readyForLocalScale() || daysSinceLastOutletOpen(ctx, day) < LOCAL_EXPANSION_COOLDOWN_DAYS) {
            return;
        }

        for (String subregionCode : List.copyOf(ctx.getActiveSubregionCodes())) {
            List<SimOutlet> subregionOutlets = ctx.getActiveOutlets().stream()
                    .filter(outlet -> outlet.getSubregionCode().equals(subregionCode))
                    .toList();
            if (subregionOutlets.isEmpty()) {
                continue;
            }

            String regionCode = subregionOutlets.getFirst().getRegionCode();
            SimulationConfig.RegionConfig regionConfig = findRegionConfig(ctx.getConfig(), regionCode);
            boolean hasInactivePeerSubregions = regionConfig != null
                    && regionConfig.subregions() != null
                    && regionConfig.subregions().stream()
                    .map(SimulationConfig.RegionConfig.SubregionConfig::code)
                    .anyMatch(code -> !ctx.getActiveSubregionCodes().contains(code));
            boolean hasInactiveRegions = ctx.getConfig().regions().stream()
                    .anyMatch(region -> !ctx.getActiveRegionCodes().contains(region.code()));

            GroupPerformance performance = summarizePerformance(subregionOutlets);
            double demandPressure = clamp(
                    performance.stockoutPct() * 1.05
                            + performance.servicePct() * 0.92
                            + Math.max(0.0, performance.serviceSlotUtilization() - 0.72) * 1.25
                            + Math.max(0.0, performance.occupancy() - 0.24) * 0.65
                            + Math.max(0.0, health.trailingLostSalesRatio() - 0.10) * 0.30,
                    0.0, 1.35);
            double economicsStrength = clamp(
                    (performance.contributionMarginPct() - 0.10) * 2.6
                            + (performance.netMarginPct() + 0.02) * 1.6
                            + Math.max(0.0, health.expansionMomentum() - 0.35) * 0.35,
                    0.0, 1.25);
            double stability = clamp(
                    1.0
                            - performance.wastePct() * 2.2
                            - performance.averageAttendanceStress() * 0.10
                            - performance.distressedShare() * 0.22,
                    0.15, 1.05);
            double strategicScale = clamp(
                    Math.max(0.0, performance.expansionReadiness() - 0.48) * 0.72
                            + Math.max(0.0, performance.averageReputation() - 0.98) * 1.10
                            + Math.max(0.0, performance.netMarginPct() - 0.01) * 2.20,
                    0.0, 1.08);
            boolean flagshipCloneReady = subregionOutlets.size() == 1
                    && performance.contributionMarginPct() >= 0.24
                    && performance.netMarginPct() >= 0.03
                    && performance.serviceSlotUtilization() >= 0.68
                    && performance.averagePaybackMonths() != null
                    && performance.averagePaybackMonths() <= 8.0;
            double strategyPenalty = 0.0;
            if (hasInactivePeerSubregions && health.readyForSubregionScale()) {
                strategyPenalty += 0.11;
            }
            if (!hasInactivePeerSubregions && hasInactiveRegions && health.readyForCrossRegionScale()) {
                strategyPenalty += 0.05;
            }
            double score = demandPressure * 0.30
                    + economicsStrength * 0.26
                    + stability * 0.16
                    + performance.sitePotential() * 0.12
                    + strategicScale * 0.16
                    + (flagshipCloneReady ? 0.14 : 0.0)
                    - Math.max(0, subregionOutlets.size() - 1) * 0.04
                    - strategyPenalty;
            boolean overflowRelief = performance.contributionMarginPct() >= 0.16
                    && performance.netMarginPct() >= -0.07
                    && performance.totalLostPct() >= 0.20
                    && performance.serviceSlotUtilization() >= 0.64
                    && performance.wastePct() <= 0.16
                    && (performance.averagePaybackMonths() == null || performance.averagePaybackMonths() <= 18.0);
            if (score < 0.40 || (demandPressure < 0.06 && strategicScale < 0.18 && !flagshipCloneReady && !overflowRelief)) {
                continue;
            }

            candidates.add(new GrowthCandidate(
                    GrowthActionType.LOCAL_SCALE,
                    regionCode,
                    subregionCode,
                    score,
                    "local demand pressure and strong contribution",
                    false,
                    false
            ));
        }
    }

    private void collectFlagshipLocalScaleCandidates(SimulationContext ctx, LocalDate day,
                                                     List<GrowthCandidate> candidates) {
        if (daysSinceLastOutletOpen(ctx, day) < LOCAL_EXPANSION_COOLDOWN_DAYS) {
            return;
        }

        for (String subregionCode : List.copyOf(ctx.getActiveSubregionCodes())) {
            List<SimOutlet> subregionOutlets = ctx.getActiveOutlets().stream()
                    .filter(outlet -> outlet.getSubregionCode().equals(subregionCode))
                    .toList();
            if (subregionOutlets.isEmpty() || subregionOutlets.size() != 1) {
                continue;
            }

            String regionCode = subregionOutlets.getFirst().getRegionCode();
            SimOutlet sponsor = bestGrowthSponsor(subregionOutlets);
            OutletEconomicsModel.Snapshot sponsorEconomics = OutletEconomicsModel.snapshot(sponsor);
            RecentOutletPerformance recent = summarizeRecentOutletPerformance(sponsor, 3);
            if (!recent.hasData()) {
                continue;
            }

            double projectedSpilloverRevenue = sponsorEconomics.averageMonthlyRevenue()
                    * clamp(Math.max(0.18, sponsorEconomics.totalLostPct() * 0.68), 0.18, 0.42);
            boolean reputationHealthy = sponsor.getReputationScore() >= 0.96;
            boolean reliefReadyEconomics = sponsorEconomics.contributionMarginPct() >= 0.18
                    && sponsorEconomics.paybackEstimateMonths() != null
                    && sponsorEconomics.paybackEstimateMonths() <= 12.0
                    && projectedSpilloverRevenue >= 14_000_000L;
            boolean strongStoreEconomics = sponsorEconomics.contributionMarginPct() >= 0.20
                    && sponsorEconomics.paybackEstimateMonths() != null
                    && sponsorEconomics.paybackEstimateMonths() <= 11.0
                    && (reputationHealthy
                        || sponsorEconomics.netMarginPct() >= 0.03
                        || sponsorEconomics.serviceSlotUtilization() >= 0.72)
                    && projectedSpilloverRevenue >= 16_000_000L;
            boolean recentBreakeven = recent.consecutiveBreakevenMonths() >= 2
                    || recent.consecutiveProfitableMonths() >= 2
                    || (recent.consecutiveProfitableMonths() >= 1 && recent.netMarginPct() >= 0.03);
            boolean overflowDemand = sponsorEconomics.serviceSlotUtilization() >= 0.68
                    || sponsorEconomics.totalLostPct() >= 0.18
                    || sponsorEconomics.stockoutLostPct() >= 0.10
                    || sponsorEconomics.serviceLostPct() >= 0.14;
            boolean acceptableOps = recent.wastePct() <= 0.17
                    && sponsorEconomics.serviceLostPct() <= 0.38
                    && sponsorEconomics.stockoutLostPct() <= 0.28;
            boolean matureEnough = ChronoUnit.DAYS.between(sponsor.getOpenedDate(), day) >= 120;
            boolean saturationReliefCase = reliefReadyEconomics
                    && recent.consecutiveBreakevenMonths() >= 1
                    && sponsorEconomics.serviceSlotUtilization() >= 0.78
                    && sponsorEconomics.totalLostPct() >= 0.28
                    && sponsorEconomics.netMarginPct() >= -0.04
                    && recent.wastePct() <= 0.15;

            if (!((strongStoreEconomics && recentBreakeven && overflowDemand && acceptableOps && matureEnough)
                    || (saturationReliefCase && acceptableOps && matureEnough))) {
                continue;
            }

            double score = 0.56
                    + Math.max(0.0, sponsorEconomics.contributionMarginPct() - 0.18) * 0.65
                    + Math.max(0.0, recent.netMarginPct() + 0.01) * 0.42
                    + Math.max(0.0, sponsorEconomics.totalLostPct() - 0.16) * 0.32
                    + Math.max(0.0, sponsorEconomics.serviceSlotUtilization() - 0.62) * 0.24
                    + Math.max(0.0, sponsor.getReputationScore() - 0.96) * 0.40
                    + (saturationReliefCase ? 0.08 : 0.0)
                    - Math.max(0.0, recent.wastePct() - 0.12) * 0.20
                    - Math.max(0, subregionOutlets.size() - 1) * 0.05;

            candidates.add(new GrowthCandidate(
                    GrowthActionType.LOCAL_SCALE,
                    regionCode,
                    subregionCode,
                    score,
                    "flagship outlet cloning after breakeven and sustained demand overflow",
                    false,
                    false
            ));
        }
    }

    private void collectSubregionCandidates(SimulationContext ctx, LocalDate day,
                                            ExpansionHealth health,
                                            List<GrowthCandidate> candidates) {
        if (!health.readyForSubregionScale() || daysSinceLastGrowthMove(ctx, day) < SUBREGION_EXPANSION_COOLDOWN_DAYS) {
            return;
        }

        for (String regionCode : List.copyOf(ctx.getActiveRegionCodes())) {
            SimulationConfig.RegionConfig regionConfig = findRegionConfig(ctx.getConfig(), regionCode);
            if (regionConfig == null || regionConfig.subregions() == null || regionConfig.subregions().isEmpty()) {
                continue;
            }
            List<SimOutlet> regionOutlets = ctx.getActiveOutlets().stream()
                    .filter(outlet -> outlet.getRegionCode().equals(regionCode))
                    .toList();
            GroupPerformance sponsor = summarizePerformance(regionOutlets);
            if (!isGrowthSponsorReady(sponsor)) {
                continue;
            }

            int activeSubregionsInRegion = (int) regionConfig.subregions().stream()
                    .map(SimulationConfig.RegionConfig.SubregionConfig::code)
                    .filter(ctx.getActiveSubregionCodes()::contains)
                    .count();

            for (SimulationConfig.RegionConfig.SubregionConfig subregion : regionConfig.subregions()) {
                if (ctx.getActiveSubregionCodes().contains(subregion.code())) {
                    continue;
                }

                double targetPotential = candidateSitePotential(subregion.code(), sponsor.sitePotential());
                double score = sponsor.expansionReadiness() * 0.42
                        + targetPotential * 0.32
                        + health.expansionMomentum() * 0.18
                        + Math.max(0.0, sponsor.averageReputation() - 0.98) * 0.16
                        + Math.max(0.0, sponsor.serviceSlotUtilization() - 0.70) * 0.16
                        - Math.max(0, activeSubregionsInRegion - 1) * 0.05;
                if (score < 0.42) {
                    continue;
                }

                candidates.add(new GrowthCandidate(
                        GrowthActionType.SUBREGION_SCALE,
                        regionCode,
                        subregion.code(),
                        score,
                        "same-country scaling from a stable anchor region",
                        false,
                        true
                ));
            }
        }
    }

    private void collectFlagshipSubregionCandidates(SimulationContext ctx, LocalDate day,
                                                    SimulationConfig.ExpansionConfig expansion,
                                                    List<GrowthCandidate> candidates) {
        if (daysSinceLastGrowthMove(ctx, day) < SUBREGION_EXPANSION_COOLDOWN_DAYS) {
            return;
        }

        int activeOutlets = ctx.getActiveOutlets().size();
        int configuredMinimum = Math.max(2, expansion.minActiveOutletsBeforeSubregion());
        boolean minimumGateSatisfied = activeOutlets >= configuredMinimum;
        boolean strategicBridgeSatisfied = activeOutlets >= 2
                && ctx.getActiveOutlets().stream()
                .map(OutletEconomicsModel::snapshot)
                .anyMatch(snapshot -> snapshot.contributionMarginPct() >= 0.16
                        && snapshot.netMarginPct() >= -0.05
                        && snapshot.paybackEstimateMonths() != null
                        && snapshot.paybackEstimateMonths() <= 16.0
                        && snapshot.totalLostPct() >= 0.12
                        && snapshot.serviceSlotUtilization() >= 0.58);
        if (!minimumGateSatisfied && !strategicBridgeSatisfied) {
            return;
        }

        for (String regionCode : List.copyOf(ctx.getActiveRegionCodes())) {
            SimulationConfig.RegionConfig regionConfig = findRegionConfig(ctx.getConfig(), regionCode);
            if (regionConfig == null || regionConfig.subregions() == null || regionConfig.subregions().isEmpty()) {
                continue;
            }
            List<SimOutlet> regionOutlets = ctx.getActiveOutlets().stream()
                    .filter(outlet -> outlet.getRegionCode().equals(regionCode))
                    .toList();
            if (regionOutlets.isEmpty()) {
                continue;
            }

            SimOutlet sponsor = bestGrowthSponsor(regionOutlets);
            OutletEconomicsModel.Snapshot sponsorEconomics = OutletEconomicsModel.snapshot(sponsor);
            RecentOutletPerformance recent = summarizeRecentOutletPerformance(sponsor, 4);
            if (!recent.hasData()) {
                continue;
            }

            boolean readyToSeedSubregion = recent.consecutiveBreakevenMonths() >= 2
                    && sponsorEconomics.contributionMarginPct() >= 0.12
                    && sponsorEconomics.paybackEstimateMonths() != null
                    && sponsorEconomics.paybackEstimateMonths() <= 26.0
                    && sponsorEconomics.serviceSlotUtilization() >= 0.52
                    && sponsorEconomics.totalLostPct() >= 0.10
                    && recent.wastePct() <= 0.19
                    && sponsorEconomics.serviceLostPct() <= 0.50
                    && sponsor.getReputationScore() >= 0.92;
            if (!readyToSeedSubregion) {
                continue;
            }

            int activeSubregionsInRegion = (int) regionConfig.subregions().stream()
                    .map(SimulationConfig.RegionConfig.SubregionConfig::code)
                    .filter(ctx.getActiveSubregionCodes()::contains)
                    .count();

            for (SimulationConfig.RegionConfig.SubregionConfig subregion : regionConfig.subregions()) {
                if (ctx.getActiveSubregionCodes().contains(subregion.code())) {
                    continue;
                }
                double targetPotential = candidateSitePotential(subregion.code(),
                        Math.max(0.72, outletSitePotential(sponsor)));
                double score = 0.52
                        + Math.max(0.0, sponsorEconomics.contributionMarginPct() - 0.16) * 0.44
                        + Math.max(0.0, recent.netMarginPct()) * 0.32
                        + Math.max(0.0, sponsorEconomics.totalLostPct() - 0.12) * 0.25
                        + targetPotential * 0.20
                        + Math.max(0.0, sponsor.getReputationScore() - 0.97) * 0.24
                        - Math.max(0, activeSubregionsInRegion - 1) * 0.04;
                candidates.add(new GrowthCandidate(
                        GrowthActionType.SUBREGION_SCALE,
                        regionCode,
                        subregion.code(),
                        score,
                        "profitable anchor seeding another subregion after stable breakeven months",
                        false,
                        true
                ));
            }
        }
    }

    private void collectRegionCandidates(SimulationContext ctx, LocalDate day,
                                         ExpansionHealth health,
                                         List<GrowthCandidate> candidates) {
        if (!health.readyForCrossRegionScale() || daysSinceLastGrowthMove(ctx, day) < REGION_EXPANSION_COOLDOWN_DAYS) {
            return;
        }

        GroupPerformance bestSponsor = ctx.getActiveRegionCodes().stream()
                .map(regionCode -> summarizePerformance(ctx.getActiveOutlets().stream()
                        .filter(outlet -> outlet.getRegionCode().equals(regionCode))
                        .toList()))
                .filter(this::isGrowthSponsorReady)
                .max(Comparator.comparingDouble(GroupPerformance::expansionReadiness))
                .orElse(null);
        if (bestSponsor == null) {
            return;
        }

        for (SimulationConfig.RegionConfig regionConfig : ctx.getConfig().regions()) {
            if (ctx.getActiveRegionCodes().contains(regionConfig.code())
                    || regionConfig.subregions() == null
                    || regionConfig.subregions().isEmpty()) {
                continue;
            }

            SimulationConfig.RegionConfig.SubregionConfig entrySubregion = regionConfig.subregions().stream()
                    .max(Comparator.comparingDouble(subregion -> candidateSitePotential(subregion.code(), bestSponsor.sitePotential())))
                    .orElse(regionConfig.subregions().getFirst());
            double targetPotential = candidateSitePotential(entrySubregion.code(), bestSponsor.sitePotential());
            double score = bestSponsor.expansionReadiness() * 0.38
                    + targetPotential * 0.38
                    + health.expansionMomentum() * 0.18
                    + Math.max(0.0, bestSponsor.averageReputation() - 0.99) * 0.12
                    + Math.max(0.0, bestSponsor.serviceSlotUtilization() - 0.74) * 0.12
                    - 0.05;
            if (score < 0.46) {
                continue;
            }

            candidates.add(new GrowthCandidate(
                    GrowthActionType.REGION_SCALE,
                    regionConfig.code(),
                    entrySubregion.code(),
                    score,
                    "cross-region expansion unlocked by profitable and stable operations",
                    true,
                    true
            ));
        }
    }

    private boolean applyGrowthCandidate(SimulationContext ctx, LocalDate day, GrowthCandidate candidate) {
        SimulationConfig.RegionConfig regionConfig = findRegionConfig(ctx.getConfig(), candidate.subregionCode());
        if (regionConfig == null) {
            regionConfig = findRegionConfig(ctx.getConfig(), candidate.regionCode());
        }
        if (regionConfig == null) {
            return false;
        }

        Long regionId = ctx.getRegionId(candidate.regionCode());
        if (candidate.activateRegion() && regionId == null) {
            regionId = ctx.getIdGen().nextId();
            ctx.activateRegion(candidate.regionCode(), regionId, day);
        }
        if (regionId == null) {
            regionId = ctx.getRegionId(regionConfig.code());
        }
        if (regionId == null) {
            return false;
        }
        if (candidate.activateSubregion() && !ctx.getActiveSubregionCodes().contains(candidate.subregionCode())) {
            ctx.activateSubregion(candidate.subregionCode(), day);
        }

        ZoneId tz = ZoneId.of(regionConfig.timezone());
        createOutlet(ctx, day, regionId, regionConfig.code(), candidate.subregionCode(),
                "Outlet " + candidate.subregionCode() + "-" + (countOutletsInSubregion(ctx, candidate.subregionCode()) + 1), tz);
        MonthSummary month = ctx.getCurrentMonth();
        if (month != null) {
            month.addOutletOpened();
        }
        return true;
    }

    private ExpansionHealth assessExpansionHealth(SimulationContext ctx, SimulationConfig.ExpansionConfig expansion) {
        List<MonthSummary> months = ctx.getAllMonths().stream()
                .sorted(Comparator.comparingInt(MonthSummary::getYear)
                        .thenComparingInt(MonthSummary::getMonth))
                .toList();
        List<SimOutlet> activeOutlets = ctx.getActiveOutlets();
        if (months.isEmpty() || activeOutlets.isEmpty()) {
            return ExpansionHealth.none();
        }

        int window = Math.min(3, months.size());
        List<MonthSummary> trailingMonths = months.subList(months.size() - window, months.size());
        long revenue = trailingMonths.stream().mapToLong(MonthSummary::getRevenue).sum();
        long cogs = trailingMonths.stream().mapToLong(MonthSummary::getCogs).sum();
        long payroll = trailingMonths.stream().mapToLong(MonthSummary::getPayrollCost).sum();
        long operating = trailingMonths.stream().mapToLong(MonthSummary::getOperatingCost).sum();
        long waste = trailingMonths.stream().mapToLong(MonthSummary::getWasteCost).sum();
        long lostSales = trailingMonths.stream().mapToLong(MonthSummary::getLostSalesValue).sum();

        int consecutiveBreakevenMonths = consecutiveTrailingMonths(months, month ->
                ratio(adjustedNetProfit(month), month.getRevenue()) >= BREAKEVEN_MARGIN_FLOOR);
        int consecutiveProfitableMonths = consecutiveTrailingMonths(months, month ->
                adjustedNetProfit(month) > 0);
        int consecutiveStrongProfitMonths = consecutiveTrailingMonths(months, month ->
                ratio(adjustedNetProfit(month), month.getRevenue()) >= STRONG_NET_MARGIN_FLOOR
                        && ratio(storeContribution(month), month.getRevenue()) >= STRONG_CONTRIBUTION_MARGIN_FLOOR);

        double trailingContributionMargin = ratio(revenue - cogs - payroll - waste, revenue);
        double trailingAdjustedNetMargin = ratio(revenue - cogs - payroll - operating - waste, revenue);
        double trailingLostSalesRatio = ratio(lostSales, revenue + lostSales);
        double retentionRate = 1.0 - (double) trailingMonths.stream().mapToInt(MonthSummary::getDeparted).sum()
                / Math.max(1, ctx.getActiveEmployees().size() + trailingMonths.stream().mapToInt(MonthSummary::getDeparted).sum());

        GroupPerformance network = summarizePerformance(activeOutlets);
        double softFootprintReadiness = clamp(
                ctx.getActiveOutlets().size() / (double) Math.max(1, expansion.minActiveOutletsBeforeSubregion()),
                0.35, 1.00);
        double expansionMomentum = clamp(
                consecutiveBreakevenMonths * 0.18
                        + consecutiveStrongProfitMonths * 0.26
                        + Math.max(0.0, trailingContributionMargin - 0.12) * 1.3
                        + Math.max(0.0, trailingAdjustedNetMargin + 0.01) * 0.9
                        + softFootprintReadiness * 0.16,
                0.0, 1.20);
        boolean strongEconomicsOverride = network.contributionMarginPct() >= 0.20
                && trailingAdjustedNetMargin >= 0.02
                && network.averagePaybackMonths() != null
                && network.averagePaybackMonths() <= 10.0;

        boolean readyForLocalScale = (consecutiveBreakevenMonths >= 1
                || consecutiveProfitableMonths >= 1
                || consecutiveStrongProfitMonths >= 1
                || trailingContributionMargin >= 0.12)
                && network.contributionMarginPct() >= 0.05
                && retentionRate >= expansion.minStaffRetentionRate() - 0.12
                && (network.wastePct() <= 0.16 || strongEconomicsOverride)
                && (network.servicePct() <= 0.46 || (strongEconomicsOverride && network.servicePct() <= 0.54))
                && network.distressedShare() <= 0.82
                && network.averageReputation() >= 0.94;
        boolean overflowReliefHealth = network.contributionMarginPct() >= 0.08
                && trailingAdjustedNetMargin >= -0.12
                && network.totalLostPct() >= 0.14
                && network.serviceSlotUtilization() >= 0.56
                && network.wastePct() <= 0.20
                && retentionRate >= expansion.minStaffRetentionRate() - 0.14;
        readyForLocalScale = readyForLocalScale || overflowReliefHealth;

        boolean readyForSubregionScale = (consecutiveBreakevenMonths >= 1
                || consecutiveProfitableMonths >= 1
                || consecutiveStrongProfitMonths >= 1)
                && (network.growthReadyOutlets() > 0 || network.averageReputation() >= 0.97)
                && network.contributionMarginPct() >= 0.06
                && trailingAdjustedNetMargin >= -0.10
                && retentionRate >= expansion.minStaffRetentionRate() - 0.10
                && (network.servicePct() <= 0.46 || (strongEconomicsOverride && network.servicePct() <= 0.56))
                && (network.wastePct() <= 0.18 || (strongEconomicsOverride && network.wastePct() <= 0.22));
        boolean seededSubregionHealth = network.contributionMarginPct() >= 0.08
                && trailingAdjustedNetMargin >= -0.12
                && network.totalLostPct() >= 0.12
                && network.averageReputation() >= 0.92
                && network.wastePct() <= 0.20;
        readyForSubregionScale = readyForSubregionScale || seededSubregionHealth;

        boolean readyForCrossRegionScale = (consecutiveBreakevenMonths >= 1
                || consecutiveProfitableMonths >= 1
                || consecutiveStrongProfitMonths >= 1)
                && network.growthReadyOutlets() > 0
                && trailingContributionMargin >= 0.06
                && trailingAdjustedNetMargin >= -0.12
                && retentionRate >= expansion.minStaffRetentionRate() - 0.10
                && network.wastePct() <= 0.18
                && network.servicePct() <= 0.46
                && network.distressedShare() <= 0.70
                && network.averageReputation() >= 0.94;

        return new ExpansionHealth(
                consecutiveBreakevenMonths,
                consecutiveProfitableMonths,
                consecutiveStrongProfitMonths,
                trailingContributionMargin,
                trailingAdjustedNetMargin,
                trailingLostSalesRatio,
                retentionRate,
                expansionMomentum,
                readyForLocalScale,
                readyForSubregionScale,
                readyForCrossRegionScale
        );
    }

    private GroupPerformance summarizePerformance(List<SimOutlet> outlets) {
        if (outlets.isEmpty()) {
            return GroupPerformance.empty();
        }
        List<OutletEconomicsModel.Snapshot> snapshots = outlets.stream()
                .map(OutletEconomicsModel::snapshot)
                .toList();

        double contributionMarginPct = snapshots.stream().mapToDouble(OutletEconomicsModel.Snapshot::contributionMarginPct).average().orElse(0.0);
        double netMarginPct = snapshots.stream().mapToDouble(OutletEconomicsModel.Snapshot::netMarginPct).average().orElse(0.0);
        double wastePct = snapshots.stream().mapToDouble(OutletEconomicsModel.Snapshot::wastePct).average().orElse(0.0);
        double stockoutPct = snapshots.stream().mapToDouble(OutletEconomicsModel.Snapshot::stockoutLostPct).average().orElse(0.0);
        double servicePct = snapshots.stream().mapToDouble(OutletEconomicsModel.Snapshot::serviceLostPct).average().orElse(0.0);
        double seatUtilization = snapshots.stream().mapToDouble(OutletEconomicsModel.Snapshot::seatUtilization).average().orElse(0.0);
        double serviceSlotUtilization = snapshots.stream().mapToDouble(OutletEconomicsModel.Snapshot::serviceSlotUtilization).average().orElse(0.0);
        double rollingStockoutPct = outlets.stream().mapToDouble(SimOutlet::getRollingStockoutLossRate).average().orElse(0.0);
        double rollingServicePct = outlets.stream().mapToDouble(SimOutlet::getRollingServiceLossRate).average().orElse(0.0);
        double rollingThroughputUtilization = outlets.stream().mapToDouble(SimOutlet::getRollingThroughputUtilization).average().orElse(0.0);
        stockoutPct = clamp(stockoutPct * 0.58 + rollingStockoutPct * 0.42, 0.0, 1.0);
        servicePct = clamp(servicePct * 0.58 + rollingServicePct * 0.42, 0.0, 1.0);
        serviceSlotUtilization = clamp(serviceSlotUtilization * 0.62 + rollingThroughputUtilization * 0.38, 0.0, 1.20);
        double occupancy = Math.max(seatUtilization, serviceSlotUtilization * 0.45);
        double fulfillmentRate = clamp(1.0 - (stockoutPct * 0.58 + servicePct * 0.42), 0.0, 1.0);
        double avgLocationDemand = outlets.stream().mapToDouble(SimOutlet::getLocationDemandMultiplier).average().orElse(1.0);
        double avgAffluence = outlets.stream().mapToDouble(SimOutlet::getAffluenceIndex).average().orElse(1.0);
        double avgFootTraffic = outlets.stream().mapToDouble(SimOutlet::getFootTrafficIndex).average().orElse(1.0);
        double avgCrowd = outlets.stream().mapToDouble(SimOutlet::getCrowdIndex).average().orElse(1.0);
        double avgAttendanceStress = outlets.stream().mapToDouble(SimOutlet::getAttendanceStressScore).average().orElse(0.0);
        double avgCapacityPressure = outlets.stream().mapToDouble(SimOutlet::getRollingCapacityPressure).average().orElse(1.0);
        double avgReputation = outlets.stream().mapToDouble(SimOutlet::getReputationScore).average().orElse(0.98);
        Double avgPaybackMonths = snapshots.stream()
                .map(OutletEconomicsModel.Snapshot::paybackEstimateMonths)
                .filter(value -> value != null && Double.isFinite(value))
                .mapToDouble(Double::doubleValue)
                .average()
                .stream().boxed().findFirst().orElse(null);
        long growthReadyOutlets = snapshots.stream()
                .filter(snapshot -> snapshot.contributionMarginPct() >= 0.08)
                .filter(snapshot -> snapshot.netMarginPct() >= -0.10)
                .filter(snapshot -> snapshot.paybackEstimateMonths() == null || snapshot.paybackEstimateMonths() <= 48.0)
                .count();
        long distressedOutlets = snapshots.stream()
                .filter(snapshot -> "distressed".equals(snapshot.viabilityBand()))
                .count();
        long averageLostSalesValue = Math.round(outlets.stream().mapToLong(SimOutlet::getTotalLostSalesValue).average().orElse(0.0));
        long averageMonthlyRevenue = Math.round(snapshots.stream().mapToLong(OutletEconomicsModel.Snapshot::averageMonthlyRevenue).average().orElse(0.0));
        double sitePotential = clamp(
                ((avgLocationDemand + avgAffluence + avgFootTraffic + avgCrowd) / 4.0 - 0.78) / 0.55,
                0.35, 1.10);
        double expansionReadiness = clamp(
                (contributionMarginPct - 0.06) * 2.2
                        + (netMarginPct + 0.06) * 1.2
                        + Math.max(0.0, fulfillmentRate - 0.50) * 0.55
                        + Math.max(0.0, occupancy - 0.20) * 0.6
                        + Math.max(0.0, stockoutPct + servicePct - 0.22) * 0.22
                        + Math.max(0.0, avgReputation - 0.98) * 0.55
                        + sitePotential * 0.25,
                0.0, 1.25);

        return new GroupPerformance(
                contributionMarginPct,
                netMarginPct,
                wastePct,
                stockoutPct,
                servicePct,
                seatUtilization,
                serviceSlotUtilization,
                occupancy,
                fulfillmentRate,
                avgLocationDemand,
                avgAffluence,
                avgFootTraffic,
                avgCrowd,
                avgAttendanceStress,
                avgCapacityPressure,
                avgReputation,
                avgPaybackMonths,
                averageMonthlyRevenue,
                averageLostSalesValue,
                sitePotential,
                expansionReadiness,
                growthReadyOutlets,
                ratio(distressedOutlets, outlets.size())
        );
    }

    private SimOutlet bestGrowthSponsor(List<SimOutlet> outlets) {
        return outlets.stream()
                .max(Comparator.comparingDouble(outlet -> {
                    OutletEconomicsModel.Snapshot economics = OutletEconomicsModel.snapshot(outlet);
                    double paybackBoost = economics.paybackEstimateMonths() == null
                            ? 0.0
                            : clamp((12.0 - economics.paybackEstimateMonths()) / 12.0, -0.2, 0.6);
                    return economics.contributionMarginPct() * 2.2
                            + economics.netMarginPct() * 1.3
                            + economics.serviceSlotUtilization() * 0.45
                            + Math.max(0.0, outlet.getReputationScore() - 0.98) * 0.75
                            + paybackBoost
                            - economics.wastePct() * 0.80
                            - economics.totalLostPct() * 0.35;
                }))
                .orElse(outlets.getFirst());
    }

    private double outletSitePotential(SimOutlet outlet) {
        return clamp(
                ((outlet.getLocationDemandMultiplier()
                        + outlet.getAffluenceIndex()
                        + outlet.getFootTrafficIndex()
                        + outlet.getCrowdIndex()) / 4.0 - 0.78) / 0.55,
                0.35, 1.10);
    }

    private RecentOutletPerformance summarizeRecentOutletPerformance(SimOutlet outlet, int months) {
        List<Long> revenueSeries = outlet.getMonthlyRevenue();
        if (revenueSeries.isEmpty()) {
            return RecentOutletPerformance.empty();
        }

        int size = revenueSeries.size();
        int start = Math.max(0, size - months);
        long revenue = 0L;
        long cogs = 0L;
        long payroll = 0L;
        long operating = 0L;
        long waste = 0L;
        long lostSales = 0L;
        int consecutiveBreakeven = 0;
        int consecutiveProfitable = 0;

        for (int i = start; i < size; i++) {
            long monthRevenue = longAt(outlet.getMonthlyRevenue(), i);
            long monthCogs = longAt(outlet.getMonthlyCogs(), i);
            long monthPayroll = longAt(outlet.getMonthlyPayrollCost(), i);
            long monthOperating = longAt(outlet.getMonthlyOperatingCost(), i);
            long monthWaste = longAt(outlet.getMonthlyWasteCost(), i);
            long monthLost = longAt(outlet.getMonthlyLostSalesValue(), i);
            revenue += monthRevenue;
            cogs += monthCogs;
            payroll += monthPayroll;
            operating += monthOperating;
            waste += monthWaste;
            lostSales += monthLost;
        }

        for (int i = size - 1; i >= start; i--) {
            long monthRevenue = longAt(outlet.getMonthlyRevenue(), i);
            long adjustedNet = monthRevenue
                    - longAt(outlet.getMonthlyCogs(), i)
                    - longAt(outlet.getMonthlyPayrollCost(), i)
                    - longAt(outlet.getMonthlyOperatingCost(), i)
                    - longAt(outlet.getMonthlyWasteCost(), i);
            long contribution = monthRevenue
                    - longAt(outlet.getMonthlyCogs(), i)
                    - longAt(outlet.getMonthlyPayrollCost(), i)
                    - longAt(outlet.getMonthlyWasteCost(), i);
            if (ratio(adjustedNet, monthRevenue) >= BREAKEVEN_MARGIN_FLOOR) {
                consecutiveBreakeven++;
            } else {
                break;
            }
            if (adjustedNet > 0 && ratio(contribution, monthRevenue) >= STRONG_CONTRIBUTION_MARGIN_FLOOR) {
                consecutiveProfitable++;
            }
        }

        return new RecentOutletPerformance(
                size - start,
                ratio(revenue - cogs - payroll - waste, revenue),
                ratio(revenue - cogs - payroll - operating - waste, revenue),
                ratio(waste, revenue),
                ratio(lostSales, revenue + lostSales),
                consecutiveBreakeven,
                consecutiveProfitable
        );
    }

    private long longAt(List<Long> values, int index) {
        if (index < 0 || index >= values.size()) {
            return 0L;
        }
        return values.get(index);
    }

    private boolean isGrowthSponsorReady(GroupPerformance performance) {
        return performance.growthReadyOutlets() > 0
                && performance.contributionMarginPct() >= 0.08
                && performance.fulfillmentRate() >= 0.48
                && (performance.wastePct() <= 0.18
                    || (performance.contributionMarginPct() >= 0.20
                        && performance.netMarginPct() >= -0.03
                        && performance.averagePaybackMonths() != null
                        && performance.averagePaybackMonths() <= 16.0
                        && performance.wastePct() <= 0.22))
                && (performance.servicePct() <= 0.46
                    || (performance.serviceSlotUtilization() >= 0.60 && performance.servicePct() <= 0.56))
                && performance.averageReputation() >= 0.94
                && performance.distressedShare() <= 0.72
                && (performance.averagePaybackMonths() == null || performance.averagePaybackMonths() <= 60.0);
    }

    private int countOutletsInSubregion(SimulationContext ctx, String subregionCode) {
        return (int) ctx.getOutlets().values().stream()
                .filter(outlet -> outlet.getSubregionCode().equals(subregionCode))
                .count();
    }

    private int consecutiveTrailingMonths(List<MonthSummary> months,
                                          java.util.function.Predicate<MonthSummary> predicate) {
        int consecutive = 0;
        for (int i = months.size() - 1; i >= 0; i--) {
            if (!predicate.test(months.get(i))) {
                break;
            }
            consecutive++;
        }
        return consecutive;
    }

    private long adjustedNetProfit(MonthSummary month) {
        return month.getRevenue() - month.getCogs() - month.getPayrollCost()
                - month.getOperatingCost() - month.getWasteCost();
    }

    private long storeContribution(MonthSummary month) {
        return month.getRevenue() - month.getCogs() - month.getPayrollCost() - month.getWasteCost();
    }

    private int daysSinceLastOutletOpen(SimulationContext ctx, LocalDate day) {
        LocalDate lastOpen = ctx.getOutlets().values().stream()
                .map(SimOutlet::getOpenedDate)
                .max(LocalDate::compareTo)
                .orElse(null);
        return lastOpen == null ? Integer.MAX_VALUE : (int) ChronoUnit.DAYS.between(lastOpen, day);
    }

    private int daysSinceLastGrowthMove(SimulationContext ctx, LocalDate day) {
        LocalDate lastMove = ctx.getOutlets().values().stream()
                .map(SimOutlet::getOpenedDate)
                .max(LocalDate::compareTo)
                .orElse(null);
        LocalDate lastRegionActivation = ctx.getActiveRegionCodes().stream()
                .map(ctx::getRegionActivatedOn)
                .filter(date -> date != null)
                .max(LocalDate::compareTo)
                .orElse(null);
        if (lastRegionActivation != null && (lastMove == null || lastRegionActivation.isAfter(lastMove))) {
            lastMove = lastRegionActivation;
        }
        return lastMove == null ? Integer.MAX_VALUE : (int) ChronoUnit.DAYS.between(lastMove, day);
    }

    private double candidateSitePotential(String subregionCode, double sponsorSitePotential) {
        RegionalEconomics.RegionProfile profile = RegionalEconomics.profileFor(subregionCode);
        double demandScore = normalize(profile.marketDemandMultiplier(), 0.88, 1.18);
        double revenueVelocityScore = normalize(profile.referenceMonthlySales(), 26.0, 78.0);
        double revenuePotential = Math.max(1.0, profile.baseMealPrice() * (double) profile.referenceMonthlySales());
        double rentBurden = profile.baseRent() / revenuePotential;
        double rentScore = clamp(1.05 - rentBurden * 4.0, 0.48, 1.05);
        double foodCostScore = clamp(1.06 - (profile.targetFoodCostRatio() - 0.26) * 3.1, 0.66, 1.05);
        double incomeFit = clamp(0.90 + profile.demandIncomeElasticity() * 0.35, 0.78, 1.04);
        double priceElasticityFit = clamp(1.02 - Math.abs(profile.demandPriceElasticity() + 0.74) * 0.40, 0.82, 1.04);
        double baseScore = demandScore * 0.28
                + revenueVelocityScore * 0.24
                + rentScore * 0.18
                + foodCostScore * 0.14
                + incomeFit * 0.08
                + priceElasticityFit * 0.08;
        return clamp(baseScore * (0.94 + (sponsorSitePotential - 0.70) * 0.10), 0.40, 1.18);
    }

    private double normalize(double value, double min, double max) {
        if (max <= min) {
            return 0.0;
        }
        return clamp((value - min) / (max - min), 0.0, 1.0);
    }

    private double ratio(long numerator, long denominator) {
        if (denominator <= 0) {
            return 0.0;
        }
        return numerator / (double) denominator;
    }

    private double ratio(long numerator, int denominator) {
        if (denominator <= 0) {
            return 0.0;
        }
        return numerator / (double) denominator;
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private void createOutlet(SimulationContext ctx, LocalDate day, long regionId,
                              String regionCode, String subregionCode, String name, ZoneId tz) {
        long outletId = ctx.getIdGen().nextId();
        String code = ctx.nextOutletCode();
        int outletOrdinalInSubregion = (int) ctx.getOutlets().values().stream()
                .filter(existing -> existing.getSubregionCode().equals(subregionCode))
                .count() + 1;
        OperationalRealism.OutletSiteProfile site = OperationalRealism.assignOutletSite(
                regionCode, subregionCode, ctx.getRandom(), outletOrdinalInSubregion);

        SimOutlet outlet = new SimOutlet(outletId, code, name, regionId,
                regionCode, subregionCode,
                site.locationTier(), site.areaSqm(), site.seatCount(),
                site.tableCount(), site.serviceSlots(), site.baseMonthlyRent(),
                site.demandMultiplier(), site.affluenceIndex(), site.footTrafficIndex(),
                site.crowdIndex(), site.dineInShare(), day);

        // Draft → Active on same day
        StatusTransitions.validate(StatusTransitions.OUTLET, "Outlet", "draft", "active");
        outlet.setStatus("active");
        outlet.setOpenedAt(ctx.getClock().timestampAt(8, 0, tz));

        ctx.addOutlet(outlet);

        // Create shifts for this outlet
        String[][] shifts = {
                {"06_08", "Open Prep", "06:00:00", "08:00:00", "0"},
                {"08_10", "Breakfast", "08:00:00", "10:00:00", "0"},
                {"10_12", "Pre-Lunch", "10:00:00", "12:00:00", "0"},
                {"12_14", "Lunch Peak", "12:00:00", "14:00:00", "0"},
                {"14_16", "Afternoon", "14:00:00", "16:00:00", "0"},
                {"16_18", "Pre-Dinner", "16:00:00", "18:00:00", "0"},
                {"18_20", "Dinner Peak", "18:00:00", "20:00:00", "0"},
                {"20_22", "Late Close", "20:00:00", "22:00:00", "0"}
        };
        for (String[] s : shifts) {
            long shiftId = ctx.getIdGen().nextId();
            ctx.addShiftEvent(new SimulationContext.ShiftEvent(
                    shiftId, outletId, code + "-" + s[0], s[1], s[2], s[3], Integer.parseInt(s[4])));
            ctx.incrementRowCount("shift", 1);
            ctx.registerShiftForOutlet(outletId, s[0], shiftId);
        }

        // Create ordering tables for this outlet (5-10 tables)
        int tableCount = outlet.getTableCount();
        for (int t = 1; t <= tableCount; t++) {
            long tableId = ctx.getIdGen().nextId();
            String tableCode = String.format("T%02d", t);
            String token = code + "-" + tableCode + "-" + Long.toHexString(tableId).substring(0, 8);
            ctx.addOrderingTableEvent(new SimulationContext.OrderingTableEvent(
                    tableId, outletId, tableCode, "Table " + t, token));
            ctx.registerOrderingTable(outletId, tableId);
            ctx.incrementRowCount("ordering_table", 1);
        }

        // Emit audit log for outlet creation
        ctx.addAuditLogEvent(new SimulationContext.AuditLogEvent(
                ctx.getIdGen().nextId(), null, "insert", "outlet",
                String.valueOf(outletId), "New outlet opened: " + code));
    }

    private SimulationConfig.RegionConfig findRegionConfig(SimulationConfig config, String codeOrSubregion) {
        if (config.regions() == null) return null;
        for (SimulationConfig.RegionConfig r : config.regions()) {
            if (r.code().equals(codeOrSubregion)) return r;
            if (r.subregions() != null) {
                for (var sub : r.subregions()) {
                    if (sub.code().equals(codeOrSubregion)) return r;
                }
            }
        }
        return null;
    }

    private enum GrowthActionType {
        LOCAL_SCALE,
        SUBREGION_SCALE,
        REGION_SCALE
    }

    private record ExpansionHealth(
            int consecutiveBreakevenMonths,
            int consecutiveProfitableMonths,
            int consecutiveStrongProfitMonths,
            double trailingContributionMargin,
            double trailingAdjustedNetMargin,
            double trailingLostSalesRatio,
            double retentionRate,
            double expansionMomentum,
            boolean readyForLocalScale,
            boolean readyForSubregionScale,
            boolean readyForCrossRegionScale
    ) {
        static ExpansionHealth none() {
            return new ExpansionHealth(0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0, false, false, false);
        }

        boolean readyForAnyGrowth() {
            return readyForLocalScale || readyForSubregionScale || readyForCrossRegionScale;
        }
    }

    private record GroupPerformance(
            double contributionMarginPct,
            double netMarginPct,
            double wastePct,
            double stockoutPct,
            double servicePct,
            double seatUtilization,
            double serviceSlotUtilization,
            double occupancy,
            double fulfillmentRate,
            double averageLocationDemandMultiplier,
            double averageAffluenceIndex,
            double averageFootTrafficIndex,
            double averageCrowdIndex,
            double averageAttendanceStress,
            double averageCapacityPressure,
            double averageReputation,
            Double averagePaybackMonths,
            long averageMonthlyRevenue,
            long averageLostSalesValue,
            double sitePotential,
            double expansionReadiness,
            long growthReadyOutlets,
            double distressedShare
    ) {
        static GroupPerformance empty() {
            return new GroupPerformance(0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0,
                    0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 0.98, null,
                    0L, 0L, 0.0, 0.0, 0L, 1.0);
        }

        double totalLostPct() {
            return Math.max(0.0, Math.min(1.0, stockoutPct + servicePct));
        }
    }

    private record GrowthCandidate(
            GrowthActionType actionType,
            String regionCode,
            String subregionCode,
            double score,
            String rationale,
            boolean activateRegion,
            boolean activateSubregion
    ) {}

    private record RecentOutletPerformance(
            int months,
            double contributionMarginPct,
            double netMarginPct,
            double wastePct,
            double lostSalesRatio,
            int consecutiveBreakevenMonths,
            int consecutiveProfitableMonths
    ) {
        static RecentOutletPerformance empty() {
            return new RecentOutletPerformance(0, 0.0, 0.0, 1.0, 1.0, 0, 0);
        }

        boolean hasData() {
            return months > 0;
        }
    }
}
