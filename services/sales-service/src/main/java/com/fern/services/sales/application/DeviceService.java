package com.fern.services.sales.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.repository.BaseRepository;
import com.fern.services.sales.api.DeviceDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import org.springframework.stereotype.Service;

@Service
public class DeviceService extends BaseRepository {

    private final SnowflakeIdGenerator snowflake;

    public DeviceService(DataSource dataSource, SnowflakeIdGenerator snowflake) {
        super(dataSource);
        this.snowflake = snowflake;
    }

    public DeviceDtos.ProvisionResponse provision(DeviceDtos.ProvisionRequest request) {
        return executeInTransaction(conn -> {
            int workerId = allocateWorkerId(conn);
            long deviceId = snowflake.generateId();
            insertDevice(conn, deviceId, request, workerId);
            return new DeviceDtos.ProvisionResponse(deviceId, workerId);
        });
    }

    public void recordLastSeen(long deviceId) {
        execute(
            "UPDATE core.device_registry SET last_seen_at = NOW() WHERE id = ?",
            deviceId
        );
    }

    private int allocateWorkerId(Connection conn) throws Exception {
        // Find lowest unused worker_id in [128, 1023]
        String sql = """
            SELECT s.id AS worker_id
            FROM generate_series(128, 1023) AS s(id)
            WHERE NOT EXISTS (
                SELECT 1 FROM core.device_registry dr
                WHERE dr.worker_id = s.id AND dr.revoked_at IS NULL
            )
            ORDER BY s.id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                throw ServiceException.conflict("No available worker_id slots (max 896 devices per cluster)");
            }
            return rs.getInt("worker_id");
        }
    }

    private void insertDevice(Connection conn, long deviceId, DeviceDtos.ProvisionRequest request, int workerId) throws Exception {
        String sql = """
            INSERT INTO core.device_registry
              (id, outlet_id, device_label, worker_id, browser_fingerprint_hash, issued_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, deviceId);
            ps.setLong(2, request.outletId());
            ps.setString(3, request.deviceLabel());
            ps.setInt(4, workerId);
            ps.setString(5, request.browserFingerprintHash());
            ps.setTimestamp(6, Timestamp.from(Instant.now()));
            ps.executeUpdate();
        }
    }
}
