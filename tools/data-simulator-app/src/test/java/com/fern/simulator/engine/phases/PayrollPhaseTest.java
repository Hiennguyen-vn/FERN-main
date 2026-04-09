package com.fern.simulator.engine.phases;

import com.fern.simulator.config.ConfigLoader;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.model.SimEmployee;
import com.fern.simulator.model.SimOutlet;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;

class PayrollPhaseTest {

    @Test
    void includesEmployeesWhoWorkedDuringPreviousMonthEvenIfTerminatedBeforePayDay() throws Exception {
        SimulationContext ctx = new SimulationContext(ConfigLoader.loadPreset("small"), false);
        ctx.activateRegion("VN", 1L, LocalDate.of(2024, 1, 1));
        ctx.activateSubregion("VN-HCM", LocalDate.of(2024, 1, 1));
        ctx.advanceToDay(LocalDate.of(2024, 5, 5));

        SimOutlet outlet = new SimOutlet(10L, "SIM-SMALL-OUT-0001", "Outlet 1", 1L, "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");
        ctx.addOutlet(outlet);

        SimEmployee employee = new SimEmployee(
                100L, 101L, "SIM-SMALL-EMP-0001", "sim_small_emp_0001",
                "Nguyen Van Test", "male", outlet.getId(), "VN", "cashier",
                LocalDate.of(2024, 4, 1), 9_000_000L, "VND", "full_time", "monthly"
        );
        employee.setUserStatus("inactive");
        employee.setContractStatus("terminated");
        employee.setTerminationDate(LocalDate.of(2024, 4, 26));
        ctx.addEmployee(employee);
        ctx.recordWorkedShift(employee.getUserId(), outlet.getId(), 1L,
                LocalDate.of(2024, 4, 10), 8.0, "present", false);
        ctx.recordWorkedShift(employee.getUserId(), outlet.getId(), 1L,
                LocalDate.of(2024, 4, 11), 9.5, "late", true);

        new PayrollPhase().execute(ctx, LocalDate.of(2024, 5, 5));

        assertEquals(1, ctx.getDirtyPayrolls().size());
        assertEquals(1, ctx.getDirtyPayrolls().get(0).timesheets().size());
        assertEquals(employee.getUserId(), ctx.getDirtyPayrolls().get(0).timesheets().get(0).userId());
        assertEquals(17.5, ctx.getDirtyPayrolls().get(0).timesheets().get(0).workHours());
    }

    @Test
    void paysHourlyEmployeesByActualWorkedHours() throws Exception {
        SimulationContext ctx = new SimulationContext(ConfigLoader.loadPreset("small"), false);
        ctx.activateRegion("VN", 1L, LocalDate.of(2024, 1, 1));
        ctx.activateSubregion("VN-HCM", LocalDate.of(2024, 1, 1));
        ctx.advanceToDay(LocalDate.of(2024, 5, 5));

        SimOutlet outlet = new SimOutlet(10L, "SIM-SMALL-OUT-0001", "Outlet 1", 1L, "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");
        ctx.addOutlet(outlet);

        SimEmployee employee = new SimEmployee(
                100L, 101L, "SIM-SMALL-EMP-0001", "sim_small_emp_0001",
                "Nguyen Van Flex", "male", outlet.getId(), "VN", "cashier",
                LocalDate.of(2024, 4, 1), 58_000L, "VND", "part_time", "hourly"
        );
        ctx.addEmployee(employee);
        ctx.recordWorkedShift(employee.getUserId(), outlet.getId(), 1L,
                LocalDate.of(2024, 4, 10), 5.0, "present", false);
        ctx.recordWorkedShift(employee.getUserId(), outlet.getId(), 1L,
                LocalDate.of(2024, 4, 11), 6.5, "late", false);

        new PayrollPhase().execute(ctx, LocalDate.of(2024, 5, 5));

        assertEquals(667_000L, ctx.getDirtyPayrolls().get(0).timesheets().get(0).netSalary());
    }

    @Test
    void salariedEmployeesDoNotReceiveFullExtraSalaryForWeekendCoverage() throws Exception {
        SimulationContext ctx = new SimulationContext(ConfigLoader.loadPreset("small"), false);
        ctx.activateRegion("VN", 1L, LocalDate.of(2024, 1, 1));
        ctx.activateSubregion("VN-HCM", LocalDate.of(2024, 1, 1));
        ctx.advanceToDay(LocalDate.of(2024, 5, 5));

        SimOutlet outlet = new SimOutlet(10L, "SIM-SMALL-OUT-0001", "Outlet 1", 1L, "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");
        ctx.addOutlet(outlet);

        SimEmployee employee = new SimEmployee(
                100L, 101L, "SIM-SMALL-EMP-0001", "sim_small_emp_0001",
                "Nguyen Van Core", "male", outlet.getId(), "VN", "cashier",
                LocalDate.of(2024, 4, 1), 9_000_000L, "VND", "full_time", "monthly"
        );
        ctx.addEmployee(employee);

        for (LocalDate date = LocalDate.of(2024, 4, 1); !date.isAfter(LocalDate.of(2024, 4, 30)); date = date.plusDays(1)) {
            if (date.getDayOfWeek().getValue() <= 5) {
                ctx.recordWorkedShift(employee.getUserId(), outlet.getId(), 1L, date, 8.0, "present", false);
            }
        }
        ctx.recordWorkedShift(employee.getUserId(), outlet.getId(), 1L,
                LocalDate.of(2024, 4, 6), 8.0, "present", false);

        new PayrollPhase().execute(ctx, LocalDate.of(2024, 5, 5));

        assertEquals(9_000_000L, ctx.getDirtyPayrolls().get(0).timesheets().get(0).netSalary());
    }

    @Test
    void booksMarketScopedPayrollBackToTheWorkedMonth() throws Exception {
        SimulationContext ctx = new SimulationContext(ConfigLoader.loadPreset("small"), false);
        ctx.activateRegion("VN", 1L, LocalDate.of(2024, 1, 1));
        ctx.activateSubregion("VN-HCM", LocalDate.of(2024, 1, 1));

        SimOutlet outlet = new SimOutlet(10L, "SIM-SMALL-OUT-0001", "Outlet 1", 1L, "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");
        ctx.addOutlet(outlet);

        ctx.advanceToDay(LocalDate.of(2024, 4, 30));
        outlet.closeMonth();
        ctx.advanceToDay(LocalDate.of(2024, 5, 5));

        SimEmployee employee = new SimEmployee(
                100L, 101L, "SIM-SMALL-EMP-0001", "sim_small_emp_0001",
                "Nguyen Van Market", "male", outlet.getId(), "VN-HCM", "cashier",
                LocalDate.of(2024, 4, 1), 58_000L, "VND", "part_time", "hourly"
        );
        ctx.addEmployee(employee);
        ctx.recordWorkedShift(employee.getUserId(), outlet.getId(), 1L,
                LocalDate.of(2024, 4, 10), 5.0, "present", false);
        ctx.recordWorkedShift(employee.getUserId(), outlet.getId(), 1L,
                LocalDate.of(2024, 4, 11), 6.5, "late", false);

        new PayrollPhase().execute(ctx, LocalDate.of(2024, 5, 5));

        assertEquals(1, ctx.getDirtyPayrolls().size());
        assertEquals(667_000L, ctx.getMonthSummary(2024, 4).getPayrollCost());
        assertEquals(0L, ctx.getCurrentMonth().getPayrollCost());
        assertEquals(667_000L, outlet.getMonthlyPayrollCost().getLast());
        assertEquals(667_000L, outlet.getTotalPayrollCost());
    }

    @Test
    void accruesFinalMonthPayrollWithoutCreatingExtraPayrollRows() throws Exception {
        SimulationContext ctx = new SimulationContext(ConfigLoader.loadPreset("small"), false);
        ctx.activateRegion("VN", 1L, LocalDate.of(2024, 1, 1));
        ctx.activateSubregion("VN-HCM", LocalDate.of(2024, 1, 1));

        SimOutlet outlet = new SimOutlet(10L, "SIM-SMALL-OUT-0001", "Outlet 1", 1L, "VN", "VN-HCM", LocalDate.of(2024, 1, 1));
        outlet.setStatus("active");
        ctx.addOutlet(outlet);

        ctx.advanceToDay(LocalDate.of(2024, 12, 31));
        outlet.closeMonth();

        SimEmployee employee = new SimEmployee(
                100L, 101L, "SIM-SMALL-EMP-0001", "sim_small_emp_0001",
                "Nguyen Van Final", "male", outlet.getId(), "VN-HCM", "cashier",
                LocalDate.of(2024, 12, 1), 58_000L, "VND", "part_time", "hourly"
        );
        ctx.addEmployee(employee);
        ctx.recordWorkedShift(employee.getUserId(), outlet.getId(), 1L,
                LocalDate.of(2024, 12, 10), 5.0, "present", false);
        ctx.recordWorkedShift(employee.getUserId(), outlet.getId(), 1L,
                LocalDate.of(2024, 12, 11), 6.5, "late", false);

        PayrollPhase payrollPhase = new PayrollPhase();
        payrollPhase.accrueFinalMonthIfNeeded(ctx, LocalDate.of(2024, 12, 31));

        assertEquals(0, ctx.getDirtyPayrolls().size());
        assertEquals(667_000L, ctx.getCurrentMonth().getPayrollCost());
        assertEquals(667_000L, outlet.getMonthlyPayrollCost().getLast());
        assertEquals(667_000L, outlet.getTotalPayrollCost());
    }
}
