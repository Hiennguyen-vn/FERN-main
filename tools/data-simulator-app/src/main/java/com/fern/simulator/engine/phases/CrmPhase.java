package com.fern.simulator.engine.phases;

import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.engine.SimulationRandom;
import com.fern.simulator.model.SimCustomer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

/**
 * CRM / Loyalty phase. Sinh customers organic (gắn vào sales) +
 * occasional standalone enrolments + soft-delete cho PDPL.
 * Persist crm.customer; points_ledger và OTP do SalesPhase + CrmPhase emit qua context events.
 */
public class CrmPhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(CrmPhase.class);

    private static final String[] FIRST_NAMES = {
            "Linh", "Minh", "Anh", "Tuan", "Trang", "Hung", "Huong", "Long",
            "Mai", "Phuong", "Quang", "Thanh", "Nam", "Hoa", "Vy", "Khanh"
    };
    private static final String[] LAST_NAMES = {
            "Nguyen", "Tran", "Le", "Pham", "Hoang", "Vu", "Dang", "Bui",
            "Do", "Ho", "Ngo", "Duong", "Ly"
    };

    @Override
    public String name() { return "CRM"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        SimulationConfig.CrmConfig cfg = ctx.getConfig().crmOrDefault();
        if (!cfg.enabled()) return;

        SimulationRandom rng = ctx.getRandom();

        // Walk-in enrolments scaled by active outlets (organic onboarding outside POS).
        int activeOutlets = ctx.getActiveOutlets().size();
        int enrolBudget = (int) Math.round(activeOutlets * cfg.newEnrolPerSaleChance() * 4);
        for (int i = 0; i < enrolBudget; i++) {
            createCustomer(ctx, rng, day, cfg);
        }

        // PDPL right-to-erasure: rare soft-delete tick.
        double dailyDeleteChance = cfg.softDeleteChancePerYear() / 365.0;
        for (SimCustomer c : ctx.getActiveCustomers()) {
            if (rng.chance(dailyDeleteChance)) {
                c.softDelete(day);
                ctx.markCustomerUpdated(c);
                ctx.incrementRowCount("crm_customer_deleted", 1);
            }
        }
    }

    /** Public so SalesPhase có thể tạo customer organic at sale time. */
    public static SimCustomer createCustomer(SimulationContext ctx, SimulationRandom rng,
                                             LocalDate day, SimulationConfig.CrmConfig cfg) {
        String phone = nextPhone(ctx, rng);
        if (ctx.findCustomerByPhone(phone) != null) return null;

        long id = ctx.getIdGen().nextId();
        String name = FIRST_NAMES[rng.intBetween(0, FIRST_NAMES.length - 1)]
                + " " + LAST_NAMES[rng.intBetween(0, LAST_NAMES.length - 1)];
        LocalDate birthday = day.minusYears(rng.intBetween(18, 60))
                .minusDays(rng.intBetween(0, 364));
        boolean consentMarketing = rng.chance(0.55);
        SimCustomer c = new SimCustomer(id, phone, name, birthday, consentMarketing, day);

        boolean otpVerified = rng.chance(cfg.otpVerifyRate());
        if (otpVerified) c.verifyPhone(day);
        ctx.addCustomer(c);
        ctx.incrementRowCount("crm_customer", 1);

        // Emit OTP request row (consumed if verified).
        long otpId = ctx.getIdGen().nextId();
        OffsetDateTime created = day.atStartOfDay().atOffset(ZoneOffset.UTC);
        OffsetDateTime expires = created.plusMinutes(5);
        OffsetDateTime consumed = otpVerified ? created.plusSeconds(rng.intBetween(15, 240)) : null;
        ctx.addOtpRequestEvent(new SimulationContext.OtpRequestEvent(
                otpId, phone, "mockhash:" + otpId, otpVerified ? 1 : 2,
                expires, consumed, created));
        ctx.incrementRowCount("crm_otp_request", 1);

        log.debug("Enrolled customer {} phone={} verified={}", id, phone, otpVerified);
        return c;
    }

    private static String nextPhone(SimulationContext ctx, SimulationRandom rng) {
        for (int attempt = 0; attempt < 8; attempt++) {
            StringBuilder sb = new StringBuilder("+849");
            for (int i = 0; i < 8; i++) sb.append(rng.intBetween(0, 9));
            String phone = sb.toString();
            if (ctx.findCustomerByPhone(phone) == null) return phone;
        }
        return "+849" + System.nanoTime() % 100_000_000L;
    }
}
