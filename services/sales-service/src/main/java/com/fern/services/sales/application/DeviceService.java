package com.fern.services.sales.application;

import com.fern.common.repository.BaseRepository;
import javax.sql.DataSource;
import org.springframework.stereotype.Service;

@Service
public class DeviceService extends BaseRepository {

    public DeviceService(DataSource dataSource) {
        super(dataSource);
    }

    public void recordLastSeen(long deviceId) {
        execute(
            "UPDATE core.device_registry SET last_seen_at = NOW() WHERE id = ?",
            deviceId
        );
    }
}
