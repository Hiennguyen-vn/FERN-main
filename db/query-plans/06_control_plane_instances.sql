EXPLAIN (ANALYZE, BUFFERS)
SELECT id,
       service_name,
       version,
       runtime,
       host,
       port,
       status,
       first_registered_at,
       last_heartbeat_at,
       last_offline_at,
       metadata
FROM core.service_instance
WHERE service_name = 'sales-service'
ORDER BY id;
