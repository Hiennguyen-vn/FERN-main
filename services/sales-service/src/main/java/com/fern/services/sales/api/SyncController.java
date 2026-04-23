package com.fern.services.sales.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.services.sales.application.DeviceService;
import com.fern.services.sales.application.SyncService;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping("/api/v1/sync")
public class SyncController {

    private static final int CATALOG_PAGE_LIMIT = 1000;

    private final SyncService syncService;
    private final DeviceService deviceService;
    private final ObjectMapper objectMapper;

    public SyncController(SyncService syncService, DeviceService deviceService, ObjectMapper objectMapper) {
        this.syncService = syncService;
        this.deviceService = deviceService;
        this.objectMapper = objectMapper;
    }

    // POST /api/v1/sync/push
    @PostMapping("/push")
    public ResponseEntity<SyncDtos.PushResponse> push(@RequestBody SyncDtos.PushRequest request) {
        return ResponseEntity.ok(syncService.push(request, deviceService));
    }

    // GET /api/v1/sync/pull/catalog?outlet_id=&since=&limit=
    // Streams NDJSON; each line = one CatalogRow JSON.
    // Header X-Next-Cursor: <last_updated_at_ms> for resume.
    @GetMapping(value = "/pull/catalog", produces = "application/x-ndjson")
    public ResponseEntity<StreamingResponseBody> pullCatalog(
            @RequestParam("outlet_id") long outletId,
            @RequestParam(value = "since", defaultValue = "0") long since,
            @RequestParam(value = "limit", defaultValue = "1000") int limit) {

        int pageLimit = Math.min(limit, CATALOG_PAGE_LIMIT);
        List<SyncDtos.CatalogRow> rows = syncService.pullCatalog(outletId, since, pageLimit);

        long nextCursor = rows.isEmpty() ? since
            : rows.get(rows.size() - 1).updatedAt();

        StreamingResponseBody body = outputStream -> {
            for (SyncDtos.CatalogRow row : rows) {
                outputStream.write(objectMapper.writeValueAsBytes(row));
                outputStream.write('\n');
            }
            // Checkpoint trailer
            outputStream.write(objectMapper.writeValueAsBytes(
                new CheckpointLine("checkpoint", nextCursor)
            ));
            outputStream.write('\n');
            outputStream.flush();
        };

        return ResponseEntity.ok()
            .header("X-Next-Cursor", String.valueOf(nextCursor))
            .contentType(MediaType.parseMediaType("application/x-ndjson"))
            .body(body);
    }

    // GET /api/v1/sync/pull/stock?outlet_id=
    @GetMapping("/pull/stock")
    public ResponseEntity<List<SyncDtos.StockRow>> pullStock(
            @RequestParam("outlet_id") long outletId) {
        return ResponseEntity.ok(syncService.pullStock(outletId));
    }

    // GET /api/v1/sync/manifest
    @GetMapping("/manifest")
    public ResponseEntity<SyncDtos.ManifestResponse> manifest() {
        return ResponseEntity.ok(syncService.manifest());
    }

    private record CheckpointLine(String type, long cursor) {}
}
