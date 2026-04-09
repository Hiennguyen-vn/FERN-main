package com.natsu.common.utils.services.timing;

import java.time.LocalDateTime;
import java.util.Date;

/**
 * Service for acquiring time in a specific timezone across the application.
 */
public interface TimeService {

    /**
     * @return Current time in milliseconds.
     */
    long currentTimeMillis();

    /**
     * @return Current relative LocalDateTime according to the configured configured
     *         TimeZone.
     */
    LocalDateTime currentLocalDateTime();

    /**
     * @return Current relative Date according to the configured TimeZone.
     */
    Date currentDate();
}
