package com.fern.simulator.economics;

import com.fern.simulator.model.SimOutlet;
import com.fern.simulator.model.SimProduct;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RegionalEconomicsTest {

    @Test
    void vietnamHourlyWageFloorUsesLegalRegionalAnchor() {
        assertEquals(26_000L, RegionalEconomics.hourlyWageFloor("VN-HCM"));
        assertTrue(RegionalEconomics.hourlyWageFloor("VN-DN") < RegionalEconomics.hourlyWageFloor("VN-HCM"));
        assertTrue(RegionalEconomics.hourlyWageForRole("VN-HCM", "kitchen_staff", 1.0)
                > RegionalEconomics.hourlyWageForRole("VN-HCM", "cashier", 1.0));
    }

    @Test
    void vietnamPricingStaysInsideAnchoredBandsAndRoundsInVnd() {
        LocalDate businessDate = LocalDate.of(2024, 4, 4);
        LocalDate startDate = LocalDate.of(2024, 1, 1);
        SimOutlet outlet = new SimOutlet(
                1L, "SIM-SMALL-OUT-0001", "Outlet", 1L,
                "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");

        SimProduct banhMi = new SimProduct(
                1L, "BANH-MI", "Banh Mi Thit", "BANH_MI", 1L,
                List.of(), 25_000L, 0L, "VND");
        long banhMiPrice = RegionalEconomics.effectiveProductPrice(
                banhMi, 9_000L, outlet, startDate, businessDate);

        assertTrue(banhMiPrice >= 18_000L && banhMiPrice <= 40_000L);
        assertEquals(0L, banhMiPrice % 1_000L);

        SimProduct rice = new SimProduct(
                2L, "COM-BO", "Com Bo Luc Lac", "RICE", 2L,
                List.of(), 85_000L, 0L, "VND");
        long ricePrice = RegionalEconomics.effectiveProductPrice(
                rice, 28_000L, outlet, startDate, businessDate);

        assertTrue(ricePrice >= 35_000L && ricePrice <= 95_000L);
        assertEquals(0L, ricePrice % 5_000L);
    }

    @Test
    void networkScaleEffectsRewardHealthyMultiOutletFootprintsWithoutExploding() {
        double singleOutletProcurement = RegionalEconomics.procurementScaleMultiplier(1, 1);
        double sameCityProcurement = RegionalEconomics.procurementScaleMultiplier(2, 2);
        double nationalProcurement = RegionalEconomics.procurementScaleMultiplier(2, 4);
        double sharedServices = RegionalEconomics.sharedServicesMultiplier(2, 4);

        assertEquals(1.0, singleOutletProcurement);
        assertTrue(sameCityProcurement < singleOutletProcurement);
        assertTrue(nationalProcurement < sameCityProcurement);

        double networkHalo = RegionalEconomics.networkDemandHalo(2, 4, 1.05);
        assertTrue(networkHalo > 1.0 && networkHalo <= 1.14);
        assertTrue(RegionalEconomics.forecastCoordinationMultiplier(2, 4) < 1.0);
        assertTrue(sharedServices < 1.0);
    }
}
