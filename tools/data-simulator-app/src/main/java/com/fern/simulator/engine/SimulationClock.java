package com.fern.simulator.engine;

import java.time.*;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Timezone-aware clock for generating timestamps within a simulation day.
 * <p>
 * Each simulated day has a fixed date. Events within that day get timestamps
 * at specific times-of-day in the outlet's timezone. Within the same minute,
 * events get incrementing seconds to ensure uniqueness.
 */
public final class SimulationClock {

    private LocalDate currentDate;
    private final AtomicInteger secondCounter = new AtomicInteger(0);

    public SimulationClock(LocalDate startDate) {
        this.currentDate = startDate;
    }

    /** Advance the clock to the next simulation day. */
    public void advanceTo(LocalDate date) {
        this.currentDate = date;
        this.secondCounter.set(0);
    }

    public LocalDate getCurrentDate() {
        return currentDate;
    }

    /**
     * Generate a timestamp for an event at the given hour:minute in the outlet's timezone.
     *
     * @param hour     hour of day (0–23)
     * @param minute   minute of hour (0–59)
     * @param timezone the outlet's timezone
     * @return a unique OffsetDateTime
     */
    public OffsetDateTime timestampAt(int hour, int minute, ZoneId timezone) {
        int second = secondCounter.getAndIncrement() % 60;
        LocalTime time = LocalTime.of(hour, minute, second);
        ZonedDateTime zdt = ZonedDateTime.of(currentDate, time, timezone);
        return zdt.toOffsetDateTime();
    }

    /**
     * Generate a timestamp within an operating hour range, evenly distributed.
     *
     * @param index      the event index within the day (0-based)
     * @param totalCount total number of events in this time window
     * @param startHour  start of operating window (inclusive)
     * @param endHour    end of operating window (exclusive)
     * @param timezone   the outlet's timezone
     * @return a unique OffsetDateTime spread across the operating window
     */
    public OffsetDateTime distributedTimestamp(int index, int totalCount, int startHour, int endHour, ZoneId timezone) {
        int totalMinutes = (endHour - startHour) * 60;
        int minuteOffset = totalCount > 1 ? (totalMinutes * index) / (totalCount - 1) : totalMinutes / 2;
        int hour = startHour + minuteOffset / 60;
        int minute = minuteOffset % 60;
        return timestampAt(Math.min(hour, endHour - 1), minute, timezone);
    }

    /**
     * Generate a business_date-appropriate date.
     */
    public LocalDate businessDate() {
        return currentDate;
    }
}
