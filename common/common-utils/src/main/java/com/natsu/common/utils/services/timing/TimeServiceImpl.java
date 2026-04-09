package com.natsu.common.utils.services.timing;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Date;

/**
 * Implementation of TimeAcquireService supporting fixed GMT+0 or parameterized
 * timezone offset.
 */
public class TimeServiceImpl implements TimeService {

    private final ZoneId zoneId;
    private final Clock clock;

    /**
     * Default constructor, uses fixed GMT+0 timezone.
     */
    public TimeServiceImpl() {
        this("GMT+0");
    }

    /**
     * Constructor allowing specific timezone offset configuration.
     *
     * @param zoneOffset The timezone offset (e.g. "GMT+0", "UTC", "+07:00").
     */
    public TimeServiceImpl(String zoneOffset) {
        this.zoneId = ZoneId.of(zoneOffset);
        this.clock = Clock.system(this.zoneId);
    }

    @Override
    public long currentTimeMillis() {
        return clock.millis();
    }

    @Override
    public LocalDateTime currentLocalDateTime() {
        return LocalDateTime.now(clock);
    }

    @Override
    public Date currentDate() {
        return Date.from(clock.instant());
    }
}
