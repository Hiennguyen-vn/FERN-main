package com.fern.simulator.gui;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fern.simulator.config.ConfigLoader;
import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.engine.ProgressListener;
import com.fern.simulator.engine.SimulationEngine;
import com.fern.simulator.export.UserExporter;
import com.fern.simulator.persistence.CleanupRepository;
import com.fern.simulator.persistence.DatabaseTarget;
import com.fern.simulator.persistence.SafetyChecker;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Embedded local-only web server for the simulator dashboard.
 */
public class SimulatorWebServer {

    private static final Logger log = LoggerFactory.getLogger(SimulatorWebServer.class);
    private static final DateTimeFormatter EXPORT_FILENAME_TIME = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private static final ObjectMapper MAPPER = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    private final String dbUrl;
    private final String dbUser;
    private final String dbPassword;
    private final boolean allowNonLocal;
    private final int port;

    private HttpServer server;
    private final ExecutorService executor = Executors.newFixedThreadPool(6, r -> {
        Thread t = new Thread(r, "sim-http-" + System.nanoTime());
        t.setDaemon(true);
        return t;
    });
    private final ExecutorService operationsExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "sim-operations");
        t.setDaemon(true);
        return t;
    });

    private final AtomicReference<SimulationEngine> runningEngine = new AtomicReference<>();
    private final AtomicReference<String> runStatus = new AtomicReference<>("idle");
    private final AtomicReference<Map<String, Object>> cleanupState = new AtomicReference<>(Map.of("status", "idle"));
    private final AtomicReference<Map<String, Object>> dbExportState = new AtomicReference<>(Map.of("status", "idle"));
    private final AtomicReference<Map<String, Object>> latestDiagnostics = new AtomicReference<>(Map.of());
    private final List<OutputStream> sseClients = new CopyOnWriteArrayList<>();

    private record PostgresJdbcInfo(String host, int port, String database) {}
    private record DumpPlan(String commandLabel, List<String> command) {}

    public SimulatorWebServer(String dbUrl, String dbUser, String dbPassword,
                              boolean allowNonLocal, int port) {
        this.dbUrl = dbUrl;
        this.dbUser = dbUser;
        this.dbPassword = dbPassword;
        this.allowNonLocal = allowNonLocal;
        this.port = port;
    }

    public void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.setExecutor(executor);

        server.createContext("/", this::serveSpa);
        server.createContext("/api/presets", this::getPresets);
        server.createContext("/api/config/", this::getConfig);
        server.createContext("/api/simulate", this::startSimulation);
        server.createContext("/api/simulate/stop", this::stopSimulation);
        server.createContext("/api/simulate/status", this::getSimulationStatus);
        server.createContext("/api/simulate/progress", this::sseProgress);
        server.createContext("/api/runs", this::getRuns);
        server.createContext("/api/accounts/", this::getAccounts);
        server.createContext("/api/accounts/export.csv", this::getAccountsExport);
        server.createContext("/api/summary/", this::getSummary);
        server.createContext("/api/cleanup/namespaces", this::getCleanupNamespaces);
        server.createContext("/api/cleanup/preview", this::cleanupPreview);
        server.createContext("/api/cleanup/execute", this::cleanupExecute);
        server.createContext("/api/cleanup/status", this::getCleanupStatus);
        server.createContext("/api/db-status", this::dbStatus);
        server.createContext("/api/db/export/start", this::startDbExport);
        server.createContext("/api/db/export/status", this::getDbExportStatus);
        server.createContext("/api/db/export.sql", this::exportDbSql);

        server.start();
        log.info("FERN Simulator GUI started at http://localhost:{}", port);
    }

    public void stop() {
        if (server != null) server.stop(0);
        executor.shutdownNow();
        operationsExecutor.shutdownNow();
    }

    private void sendJson(HttpExchange ex, int code, Object data) throws IOException {
        byte[] body = MAPPER.writeValueAsBytes(data);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.sendResponseHeaders(code, body.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(body);
        }
    }

    private String readBody(HttpExchange ex) throws IOException {
        return new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
    }

    private String pathParam(HttpExchange ex, String prefix) {
        return ex.getRequestURI().getPath().substring(prefix.length());
    }

    private boolean operationBusy() {
        return "running".equals(runStatus.get())
                || "running".equals(cleanupState.get().get("status"))
                || "running".equals(dbExportState.get().get("status"));
    }

    private DatabaseTarget databaseTarget() {
        return new DatabaseTarget(dbUrl, dbUser, dbPassword);
    }

    private void enforceLocalTarget() {
        if (!allowNonLocal) {
            SafetyChecker.requireLocalhost(databaseTarget());
        }
    }

    private void serveSpa(HttpExchange ex) throws IOException {
        if (!"/".equals(ex.getRequestURI().getPath())) {
            ex.sendResponseHeaders(404, -1);
            return;
        }
        try (InputStream is = getClass().getResourceAsStream("/web/index.html")) {
            if (is == null) {
                ex.sendResponseHeaders(404, -1);
                return;
            }
            byte[] html = is.readAllBytes();
            ex.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
            ex.sendResponseHeaders(200, html.length);
            try (OutputStream os = ex.getResponseBody()) {
                os.write(html);
            }
        }
    }

    private void getPresets(HttpExchange ex) throws IOException {
        sendJson(ex, 200, List.of(
                Map.of("name", "small", "label", "Small", "description", "1 year template, no default outlets"),
                Map.of("name", "medium", "label", "Medium", "description", "5 year template, outlet creation must be enabled explicitly"),
                Map.of("name", "large", "label", "Large", "description", "20 year template, outlet creation must be enabled explicitly")
        ));
    }

    private void getConfig(HttpExchange ex) throws IOException {
        String preset = pathParam(ex, "/api/config/");
        try {
            SimulationConfig config = ConfigLoader.load(null, preset);
            sendJson(ex, 200, Map.of(
                    "namespace", config.namespace(),
                    "startDate", config.startDate().toString(),
                    "endDate", config.endDate().toString(),
                    "seed", config.seed(),
                    "startingRegion", config.startingRegion(),
                    "totalDays", config.totalDays(),
                    "growth", Map.of(
                            "initialOutlets", config.expansion().initialOutlets(),
                            "rampDays", config.probability().demandRampDays(),
                            "baseDailySalesPerOutlet", config.probability().baseDailySalesPerOutlet(),
                            "monthlyTurnoverRate", config.probability().monthlyTurnoverRate(),
                            "reorderLeadTimeDays", config.probability().reorderLeadTimeDays()
                    ),
                    "realism", Map.of(
                            "carryoverDays", config.realism().stockoutCarryoverDays(),
                            "lateDeliveryChance", config.realism().lateDeliveryChance(),
                            "partialDeliveryChance", config.realism().partialDeliveryChance(),
                            "absenceChanceWeekday", config.realism().weekdayAbsenceChance(),
                            "absenceChanceWeekend", config.realism().weekendAbsenceChance(),
                            "lateChance", config.realism().lateChance(),
                            "topWasteProfiles", config.realism().categoryProfiles()
                    )
            ));
        } catch (Exception e) {
            sendJson(ex, 400, Map.of("error", e.getMessage()));
        }
    }

    @SuppressWarnings("unchecked")
    private void startSimulation(HttpExchange ex) throws IOException {
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            ex.sendResponseHeaders(405, -1);
            return;
        }
        if (operationBusy()) {
            sendJson(ex, 409, Map.of("error", "Another simulator operation is already running"));
            return;
        }

        Map<String, Object> body = MAPPER.readValue(readBody(ex), Map.class);
        String preset = (String) body.getOrDefault("preset", "small");
        boolean dryRun = Boolean.TRUE.equals(body.get("dryRun"));

        SimulationConfig config = ConfigLoader.load(null, preset);
        DatabaseTarget target = databaseTarget();

        try {
            enforceLocalTarget();
        } catch (Exception e) {
            sendJson(ex, 400, Map.of("error", e.getMessage()));
            return;
        }

        runStatus.set("running");
        latestDiagnostics.set(Map.of());
        SimulationEngine engine = new SimulationEngine();
        runningEngine.set(engine);

        operationsExecutor.submit(() -> {
            try {
                engine.run(config, target, dryRun, new GuiProgressListener());
                if (!engine.isCancelled()) {
                    runStatus.set("complete");
                }
            } catch (Exception e) {
                log.error("Simulation failed", e);
                runStatus.set("error");
                broadcast("run-error", Map.of("message", e.getMessage() != null ? e.getMessage() : "Unknown error"));
            } finally {
                runningEngine.set(null);
            }
        });

        sendJson(ex, 200, Map.of(
                "status", "started",
                "namespace", config.namespace(),
                "totalDays", config.totalDays(),
                "startDate", config.startDate().toString(),
                "endDate", config.endDate().toString()
        ));
    }

    private void stopSimulation(HttpExchange ex) throws IOException {
        SimulationEngine engine = runningEngine.get();
        if (engine == null) {
            sendJson(ex, 400, Map.of("error", "No simulation is running"));
            return;
        }
        engine.cancel();
        runStatus.set("cancelled");
        sendJson(ex, 200, Map.of("status", "cancelling"));
    }

    private void getSimulationStatus(HttpExchange ex) throws IOException {
        sendJson(ex, 200, Map.of(
                "status", runStatus.get(),
                "diagnostics", latestDiagnostics.get()
        ));
    }

    private void sseProgress(HttpExchange ex) throws IOException {
        ex.getResponseHeaders().set("Content-Type", "text/event-stream");
        ex.getResponseHeaders().set("Cache-Control", "no-cache");
        ex.getResponseHeaders().set("Connection", "keep-alive");
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.sendResponseHeaders(200, 0);

        OutputStream os = ex.getResponseBody();
        sseClients.add(os);

        try {
            os.write(("event: connected\ndata: " + MAPPER.writeValueAsString(Map.of(
                    "runStatus", runStatus.get(),
                    "cleanupStatus", cleanupState.get(),
                    "dbExportStatus", dbExportState.get()
            )) + "\n\n").getBytes(StandardCharsets.UTF_8));
            os.flush();
        } catch (IOException e) {
            sseClients.remove(os);
        }
    }

    private void getRuns(HttpExchange ex) throws IOException {
        try (Connection conn = databaseTarget().getConnection()) {
            List<Map<String, Object>> runs = new ArrayList<>();
            try (PreparedStatement ps = conn.prepareStatement("""
                    SELECT id, namespace, status, total_days, completed_days,
                           started_at, completed_at, cleaned_at, error_message,
                           result_json, progress_json, cleanup_summary_json
                    FROM core.simulator_run
                    ORDER BY started_at DESC
                    LIMIT 30
                    """)) {
                ResultSet rs = ps.executeQuery();
                while (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString("id"));
                    row.put("namespace", rs.getString("namespace"));
                    row.put("status", rs.getString("status"));
                    row.put("totalDays", rs.getInt("total_days"));
                    row.put("daysCompleted", rs.getInt("completed_days"));
                    row.put("startedAt", rs.getObject("started_at") != null ? rs.getObject("started_at").toString() : "");
                    row.put("completedAt", rs.getObject("completed_at") != null ? rs.getObject("completed_at").toString() : "");
                    row.put("cleanedAt", rs.getObject("cleaned_at") != null ? rs.getObject("cleaned_at").toString() : "");
                    row.put("error", rs.getString("error_message") != null ? rs.getString("error_message") : "");
                    row.put("result", parseJsonColumn(rs.getString("result_json")));
                    row.put("progress", parseJsonColumn(rs.getString("progress_json")));
                    row.put("cleanupSummary", parseJsonColumn(rs.getString("cleanup_summary_json")));
                    runs.add(row);
                }
            }
            sendJson(ex, 200, runs);
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("error", e.getMessage()));
        }
    }

    private void getAccounts(HttpExchange ex) throws IOException {
        String namespace = pathParam(ex, "/api/accounts/");
        try (Connection conn = databaseTarget().getConnection()) {
            List<Map<String, Object>> accounts = new ArrayList<>();
            for (UserExporter.AccountExportRow row : UserExporter.fetchByNamespace(conn, namespace)) {
                Map<String, Object> account = new LinkedHashMap<>();
                account.put("namespace", row.namespace());
                account.put("id", String.valueOf(row.userId()));
                account.put("username", row.username());
                account.put("employeeCode", row.employeeCode());
                account.put("fullName", row.fullName());
                account.put("status", row.userStatus());
                account.put("role", row.role());
                account.put("contractStatus", row.contractStatus());
                account.put("employmentType", row.employmentType());
                account.put("salaryType", row.salaryType());
                account.put("currencyCode", row.currencyCode());
                account.put("regionCode", row.regionCode());
                account.put("hireDate", row.hireDate() != null ? row.hireDate().toString() : "");
                account.put("terminationDate", row.terminationDate() != null ? row.terminationDate().toString() : "");
                account.put("createdAt", row.createdAt());
                account.put("outletCode", row.outletCode());
                account.put("outletName", row.outletName());
                accounts.add(account);
            }
            sendJson(ex, 200, accounts);
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("error", e.getMessage()));
        }
    }

    private void getAccountsExport(HttpExchange ex) throws IOException {
        Map<String, String> query = parseQuery(ex.getRequestURI().getQuery());
        String scope = query.getOrDefault("scope", "namespace");
        String namespace = query.get("namespace");
        if (!"all".equals(scope) && (namespace == null || namespace.isBlank())) {
            sendJson(ex, 400, Map.of("error", "namespace is required when scope=namespace"));
            return;
        }

        try (Connection conn = databaseTarget().getConnection()) {
            List<UserExporter.AccountExportRow> accounts = "all".equals(scope)
                    ? UserExporter.fetchAll(conn)
                    : UserExporter.fetchByNamespace(conn, namespace);

            ex.getResponseHeaders().set("Content-Type", "text/csv; charset=utf-8");
            ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" +
                    ("all".equals(scope) ? "simulator-accounts.csv" : namespace + "-accounts.csv") + "\"");
            ex.sendResponseHeaders(200, 0);
            try (OutputStream os = ex.getResponseBody()) {
                UserExporter.writeCsv(accounts, os);
            }
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("error", e.getMessage()));
        }
    }

    private void getSummary(HttpExchange ex) throws IOException {
        String namespace = pathParam(ex, "/api/summary/");
        try (Connection conn = databaseTarget().getConnection()) {
            Map<String, Object> summary = new LinkedHashMap<>();
            String[] tables = {"outlet", "app_user", "product", "item", "sale_record",
                    "inventory_transaction", "purchase_order", "payment", "payroll_timesheet", "pos_session"};
            for (String table : tables) {
                String sql = switch (table) {
                    case "outlet" -> "SELECT COUNT(*) FROM core.outlet WHERE code LIKE ?";
                    case "app_user" -> "SELECT COUNT(*) FROM core.app_user WHERE employee_code LIKE ?";
                    case "product" -> "SELECT COUNT(*) FROM core.product WHERE code LIKE ?";
                    case "item" -> "SELECT COUNT(*) FROM core.item WHERE code LIKE ?";
                    case "sale_record" -> "SELECT COUNT(*) FROM core.sale_record WHERE outlet_id IN (SELECT id FROM core.outlet WHERE code LIKE ?)";
                    case "inventory_transaction" -> "SELECT COUNT(*) FROM core.inventory_transaction WHERE outlet_id IN (SELECT id FROM core.outlet WHERE code LIKE ?)";
                    case "purchase_order" -> "SELECT COUNT(*) FROM core.purchase_order WHERE outlet_id IN (SELECT id FROM core.outlet WHERE code LIKE ?)";
                    case "payment" -> "SELECT COUNT(*) FROM core.payment WHERE sale_id IN (SELECT id FROM core.sale_record WHERE outlet_id IN (SELECT id FROM core.outlet WHERE code LIKE ?))";
                    case "payroll_timesheet" -> "SELECT COUNT(*) FROM core.payroll_timesheet WHERE user_id IN (SELECT id FROM core.app_user WHERE employee_code LIKE ?)";
                    case "pos_session" -> "SELECT COUNT(*) FROM core.pos_session WHERE outlet_id IN (SELECT id FROM core.outlet WHERE code LIKE ?)";
                    default -> "SELECT 0";
                };
                try (PreparedStatement ps = conn.prepareStatement(sql)) {
                    ps.setString(1, namespace + "%");
                    ResultSet rs = ps.executeQuery();
                    summary.put(table, rs.next() ? rs.getLong(1) : 0);
                }
            }
            sendJson(ex, 200, summary);
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("error", e.getMessage()));
        }
    }

    private void getCleanupNamespaces(HttpExchange ex) throws IOException {
        try (Connection conn = databaseTarget().getConnection()) {
            List<Map<String, Object>> namespaces = new ArrayList<>();
            for (CleanupRepository.NamespaceSummary summary : CleanupRepository.listNamespaces(conn)) {
                Map<String, Long> counts = CleanupRepository.preview(conn, summary.namespace());
                long totalRows = counts.values().stream().mapToLong(Long::longValue).sum();
                if (totalRows == 0 && summary.cleanedAt() != null) {
                    continue;
                }
                namespaces.add(Map.of(
                        "namespace", summary.namespace(),
                        "runCount", summary.runCount(),
                        "latestStatus", summary.latestStatus(),
                        "lastStartedAt", summary.lastStartedAt() != null ? summary.lastStartedAt().toString() : "",
                        "cleanedAt", summary.cleanedAt() != null ? summary.cleanedAt().toString() : "",
                        "estimatedRows", totalRows
                ));
            }
            sendJson(ex, 200, namespaces);
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("error", e.getMessage()));
        }
    }

    @SuppressWarnings("unchecked")
    private void cleanupPreview(HttpExchange ex) throws IOException {
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            ex.sendResponseHeaders(405, -1);
            return;
        }
        try {
            Map<String, Object> body = MAPPER.readValue(readBody(ex), Map.class);
            String scope = (String) body.getOrDefault("scope", "namespace");
            String namespace = (String) body.get("namespace");
            sendJson(ex, 200, buildCleanupPreview(scope, namespace));
        } catch (Exception e) {
            sendJson(ex, 400, Map.of("error", e.getMessage()));
        }
    }

    @SuppressWarnings("unchecked")
    private void cleanupExecute(HttpExchange ex) throws IOException {
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            ex.sendResponseHeaders(405, -1);
            return;
        }
        if (operationBusy()) {
            sendJson(ex, 409, Map.of("error", "Another simulator operation is already running"));
            return;
        }

        Map<String, Object> body = MAPPER.readValue(readBody(ex), Map.class);
        String scope = (String) body.getOrDefault("scope", "namespace");
        String namespace = (String) body.get("namespace");

        if (!"all".equals(scope) && (namespace == null || namespace.isBlank())) {
            sendJson(ex, 400, Map.of("error", "Namespace is required for namespace cleanup"));
            return;
        }

        long startedAtMs = System.currentTimeMillis();
        Map<String, Object> started = new LinkedHashMap<>();
        started.put("status", "running");
        started.put("scope", scope);
        started.put("namespace", namespace != null ? namespace : "");
        started.put("currentNamespace", namespace != null ? namespace : "");
        started.put("startedAtMs", startedAtMs);
        started.put("startedAt", Instant.ofEpochMilli(startedAtMs).toString());
        started.put("completedNamespaces", 0);
        started.put("totalNamespaces", 0);
        started.put("completedSteps", 0);
        started.put("totalSteps", 0);
        started.put("rowsDeleted", 0L);
        started.put("elapsedMs", 0L);
        cleanupState.set(started);
        broadcast("cleanup-status", cleanupState.get());

        operationsExecutor.submit(() -> executeCleanupJob(scope, namespace));
        sendJson(ex, 202, cleanupState.get());
    }

    private void getCleanupStatus(HttpExchange ex) throws IOException {
        sendJson(ex, 200, cleanupState.get());
    }

    private void startDbExport(HttpExchange ex) throws IOException {
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            ex.sendResponseHeaders(405, -1);
            return;
        }
        if (operationBusy()) {
            sendJson(ex, 409, Map.of("error", "Another simulator operation is already running"));
            return;
        }

        long startedAtMs = System.currentTimeMillis();
        Path outputDir = runtimeExportDirectory();
        Map<String, Object> started = new LinkedHashMap<>();
        started.put("status", "running");
        started.put("startedAtMs", startedAtMs);
        started.put("startedAt", Instant.ofEpochMilli(startedAtMs).toString());
        started.put("outputDir", outputDir.toString());
        started.put("progressPct", 0.0d);
        started.put("elapsedMs", 0L);
        dbExportState.set(started);
        broadcast("db-export-status", started);
        operationsExecutor.submit(this::executeDbExportJob);
        sendJson(ex, 202, started);
    }

    private void getDbExportStatus(HttpExchange ex) throws IOException {
        sendJson(ex, 200, dbExportState.get());
    }

    private void executeDbExportJob() {
        long startedAtMs = readLong(dbExportState.get().get("startedAtMs"), System.currentTimeMillis());
        Path outputDir = runtimeExportDirectory();
        try {
            enforceLocalTarget();
            Files.createDirectories(outputDir);
        } catch (Exception e) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("status", "error");
            error.put("message", "Failed to initialize export directory: " + e.getMessage());
            dbExportState.set(error);
            broadcast("db-export-error", error);
            return;
        }

        PostgresJdbcInfo jdbcInfo;
        try {
            jdbcInfo = parsePostgresJdbcUrl(dbUrl);
        } catch (Exception e) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("status", "error");
            error.put("message", e.getMessage());
            dbExportState.set(error);
            broadcast("db-export-error", error);
            return;
        }
        String dumpHost = normalizeDumpHost(jdbcInfo.host());

        int serverMajorVersion;
        try {
            serverMajorVersion = detectServerMajorVersion();
        } catch (Exception e) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("status", "error");
            error.put("message", "Failed to read PostgreSQL server version: " + e.getMessage());
            dbExportState.set(error);
            broadcast("db-export-error", error);
            return;
        }

        DumpPlan dumpPlan;
        try {
            dumpPlan = buildDumpPlan(jdbcInfo, dumpHost, serverMajorVersion);
        } catch (Exception e) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("status", "error");
            error.put("message", e.getMessage());
            dbExportState.set(error);
            broadcast("db-export-error", error);
            return;
        }

        long estimatedDbSizeBytes;
        try {
            estimatedDbSizeBytes = estimateDatabaseSizeBytes();
        } catch (Exception ignored) {
            estimatedDbSizeBytes = 0L;
        }

        String fileName = "fern-db-" + EXPORT_FILENAME_TIME.format(LocalDateTime.now()) + ".sql";
        Path outputFile = outputDir.resolve(fileName).toAbsolutePath().normalize();
        Path stderrFile = null;
        Process process = null;
        try {
            stderrFile = Files.createTempFile("fern-db-export-", ".stderr.log");
            ProcessBuilder pb = new ProcessBuilder(dumpPlan.command());
            pb.environment().put("PGPASSWORD", dbPassword == null ? "" : dbPassword);
            pb.environment().put("PGCONNECT_TIMEOUT", "10");
            pb.redirectOutput(outputFile.toFile());
            pb.redirectError(stderrFile.toFile());
            process = pb.start();

            while (process.isAlive()) {
                long elapsedMs = Math.max(0L, System.currentTimeMillis() - startedAtMs);
                long writtenBytes = safeFileSize(outputFile);
                long bytesPerSecond = elapsedMs > 0 ? Math.round((writtenBytes * 1000.0d) / elapsedMs) : 0L;
                Long etaMs = null;
                Double progressPct = null;
                if (estimatedDbSizeBytes > 0) {
                    progressPct = Math.min(95.0d, (writtenBytes * 100.0d) / estimatedDbSizeBytes);
                    if (bytesPerSecond > 0 && writtenBytes < estimatedDbSizeBytes) {
                        etaMs = Math.max(0L, Math.round(((estimatedDbSizeBytes - writtenBytes) * 1000.0d) / bytesPerSecond));
                    }
                }

                Map<String, Object> progress = new LinkedHashMap<>();
                progress.put("status", "running");
                progress.put("phase", "dumping");
                progress.put("startedAtMs", startedAtMs);
                progress.put("startedAt", Instant.ofEpochMilli(startedAtMs).toString());
                progress.put("outputDir", outputDir.toString());
                progress.put("outputFile", outputFile.toString());
                progress.put("fileName", fileName);
                progress.put("outputBytes", writtenBytes);
                progress.put("databaseSizeBytes", estimatedDbSizeBytes);
                progress.put("rowsPerSecond", bytesPerSecond);
                progress.put("elapsedMs", elapsedMs);
                progress.put("progressPct", progressPct);
                if (etaMs != null) {
                    progress.put("etaMs", etaMs);
                }
                progress.put("commandLabel", dumpPlan.commandLabel());
                dbExportState.set(progress);
                broadcast("db-export-progress", progress);
                Thread.sleep(1000L);
            }

            int exitCode = process.waitFor();
            String stderr = (stderrFile != null && Files.exists(stderrFile))
                    ? Files.readString(stderrFile, StandardCharsets.UTF_8).trim()
                    : "";
            long finalSize = safeFileSize(outputFile);
            long elapsedMs = Math.max(0L, System.currentTimeMillis() - startedAtMs);
            long bytesPerSecond = elapsedMs > 0 ? Math.round((finalSize * 1000.0d) / elapsedMs) : 0L;

            if (exitCode != 0) {
                String message = stderr.isBlank()
                        ? "pg_dump exited with code " + exitCode
                        : "pg_dump failed: " + stderr;
                Map<String, Object> error = new LinkedHashMap<>();
                error.put("status", "error");
                error.put("outputDir", outputDir.toString());
                error.put("outputFile", outputFile.toString());
                error.put("fileName", fileName);
                error.put("outputBytes", finalSize);
                error.put("elapsedMs", elapsedMs);
                error.put("message", message);
                dbExportState.set(error);
                broadcast("db-export-error", error);
                return;
            }

            Map<String, Object> complete = new LinkedHashMap<>();
            complete.put("status", "complete");
            complete.put("startedAtMs", startedAtMs);
            complete.put("startedAt", Instant.ofEpochMilli(startedAtMs).toString());
            complete.put("completedAtMs", System.currentTimeMillis());
            complete.put("outputDir", outputDir.toString());
            complete.put("outputFile", outputFile.toString());
            complete.put("fileName", fileName);
            complete.put("outputBytes", finalSize);
            complete.put("databaseSizeBytes", estimatedDbSizeBytes);
            complete.put("elapsedMs", elapsedMs);
            complete.put("rowsPerSecond", bytesPerSecond);
            complete.put("progressPct", 100.0d);
            complete.put("commandLabel", dumpPlan.commandLabel());
            dbExportState.set(complete);
            broadcast("db-export-complete", complete);
            log.info("DB export completed: {} ({} bytes) using {}", outputFile, finalSize, dumpPlan.commandLabel());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            Map<String, Object> error = Map.of(
                    "status", "error",
                    "message", "DB export interrupted",
                    "outputDir", outputDir.toString()
            );
            dbExportState.set(error);
            broadcast("db-export-error", error);
        } catch (Exception e) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("status", "error");
            error.put("message", "DB export failed: " + e.getMessage());
            error.put("outputDir", outputDir.toString());
            if (outputFile != null) {
                error.put("outputFile", outputFile.toString());
                error.put("fileName", fileName);
            }
            dbExportState.set(error);
            broadcast("db-export-error", error);
        } finally {
            if (stderrFile != null) {
                try {
                    Files.deleteIfExists(stderrFile);
                } catch (IOException ignored) {
                    // best effort
                }
            }
            if (process != null) {
                process.destroyForcibly();
            }
        }
    }

    private void exportDbSql(HttpExchange ex) throws IOException {
        if (!"GET".equalsIgnoreCase(ex.getRequestMethod())) {
            ex.sendResponseHeaders(405, -1);
            return;
        }

        try {
            enforceLocalTarget();
        } catch (Exception e) {
            sendJson(ex, 400, Map.of("error", e.getMessage()));
            return;
        }

        PostgresJdbcInfo jdbcInfo;
        try {
            jdbcInfo = parsePostgresJdbcUrl(dbUrl);
        } catch (IllegalArgumentException e) {
            sendJson(ex, 400, Map.of("error", e.getMessage()));
            return;
        }
        String dumpHost = normalizeDumpHost(jdbcInfo.host());

        int serverMajorVersion;
        try {
            serverMajorVersion = detectServerMajorVersion();
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("error", "Failed to read PostgreSQL server version: " + e.getMessage()));
            return;
        }

        DumpPlan dumpPlan;
        try {
            dumpPlan = buildDumpPlan(jdbcInfo, dumpHost, serverMajorVersion);
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("error", e.getMessage()));
            return;
        }

        Path tempDump;
        try {
            tempDump = Files.createTempFile("fern-db-export-", ".sql");
        } catch (IOException e) {
            sendJson(ex, 500, Map.of("error", "Failed to allocate temporary dump file: " + e.getMessage()));
            return;
        }

        String fileName = "fern-db-" + EXPORT_FILENAME_TIME.format(LocalDateTime.now()) + ".sql";
        try {
            ProcessBuilder pb = new ProcessBuilder(dumpPlan.command());
            pb.environment().put("PGPASSWORD", dbPassword == null ? "" : dbPassword);
            pb.environment().put("PGCONNECT_TIMEOUT", "10");
            pb.redirectOutput(tempDump.toFile());
            Process process = pb.start();
            String stderr;
            try (InputStream err = process.getErrorStream()) {
                stderr = new String(err.readAllBytes(), StandardCharsets.UTF_8);
            }
            int exitCode = process.waitFor();
            if (exitCode != 0) {
                Files.deleteIfExists(tempDump);
                String trimmed = stderr == null ? "" : stderr.trim();
                String message = trimmed.isEmpty()
                        ? "pg_dump exited with code " + exitCode
                        : "pg_dump failed: " + trimmed;
                sendJson(ex, 500, Map.of("error", message));
                return;
            }

            long size = Files.size(tempDump);
            ex.getResponseHeaders().set("Content-Type", "application/sql; charset=utf-8");
            ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" + fileName + "\"");
            ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
            ex.sendResponseHeaders(200, size);
            try (OutputStream out = ex.getResponseBody();
                 InputStream in = Files.newInputStream(tempDump)) {
                in.transferTo(out);
            }
            log.info("Exported SQL dump: {} bytes from {} using {} (server major={})", size, dbUrl, dumpPlan.commandLabel(), serverMajorVersion);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            sendJson(ex, 500, Map.of("error", "SQL export interrupted"));
        } catch (IOException e) {
            sendJson(ex, 500, Map.of("error", "SQL export failed: " + e.getMessage()));
        } finally {
            try {
                Files.deleteIfExists(tempDump);
            } catch (IOException ignored) {
                // best effort
            }
        }
    }

    private DumpPlan buildDumpPlan(PostgresJdbcInfo jdbcInfo, String dumpHost, int serverMajorVersion) throws Exception {
        try {
            String pgDumpBinary = resolvePgDumpBinary(serverMajorVersion);
            return new DumpPlan(pgDumpBinary, List.of(
                    pgDumpBinary,
                    "--format=plain",
                    "--encoding=UTF8",
                    "--no-owner",
                    "--no-privileges",
                    "--no-password",
                    "--host", dumpHost,
                    "--port", String.valueOf(jdbcInfo.port()),
                    "--username", dbUser,
                    jdbcInfo.database()
            ));
        } catch (Exception localPgDumpError) {
            String container = resolveDockerPostgresContainer();
            if (container == null || container.isBlank()) {
                throw new IllegalStateException(localPgDumpError.getMessage(), localPgDumpError);
            }
            return new DumpPlan("docker exec " + container + " pg_dump", List.of(
                    "docker", "exec",
                    "-e", "PGPASSWORD=" + (dbPassword == null ? "" : dbPassword),
                    container,
                    "pg_dump",
                    "--format=plain",
                    "--encoding=UTF8",
                    "--no-owner",
                    "--no-privileges",
                    "--no-password",
                    "--host", "127.0.0.1",
                    "--port", "5432",
                    "--username", dbUser,
                    jdbcInfo.database()
            ));
        }
    }

    private long estimateDatabaseSizeBytes() throws SQLException {
        try (Connection conn = databaseTarget().getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT pg_database_size(current_database())");
             ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                return rs.getLong(1);
            }
        }
        return 0L;
    }

    private long safeFileSize(Path outputFile) {
        try {
            return Files.exists(outputFile) ? Files.size(outputFile) : 0L;
        } catch (IOException ignored) {
            return 0L;
        }
    }

    private Path runtimeExportDirectory() {
        return Path.of("simulator-output", "runtime", "db-exports").toAbsolutePath().normalize();
    }

    private void dbStatus(HttpExchange ex) throws IOException {
        try (Connection conn = databaseTarget().getConnection()) {
            sendJson(ex, 200, Map.of("connected", true, "url", dbUrl));
        } catch (Exception e) {
            sendJson(ex, 200, Map.of("connected", false, "error", e.getMessage()));
        }
    }

    private PostgresJdbcInfo parsePostgresJdbcUrl(String jdbc) {
        if (jdbc == null || !jdbc.startsWith("jdbc:postgresql://")) {
            throw new IllegalArgumentException("Unsupported JDBC URL for SQL export: " + jdbc);
        }
        URI uri = URI.create(jdbc.substring("jdbc:".length()));
        String host = uri.getHost();
        int port = uri.getPort() > 0 ? uri.getPort() : 5432;
        String path = uri.getPath();
        String database = (path == null) ? "" : path.replaceFirst("^/", "");
        if (host == null || host.isBlank() || database.isBlank()) {
            throw new IllegalArgumentException("Invalid PostgreSQL JDBC URL: " + jdbc);
        }
        return new PostgresJdbcInfo(host, port, database);
    }

    private int detectServerMajorVersion() throws SQLException {
        try (Connection conn = databaseTarget().getConnection();
             PreparedStatement ps = conn.prepareStatement("SHOW server_version_num");
             ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                throw new SQLException("SHOW server_version_num returned no rows");
            }
            String raw = rs.getString(1);
            if (raw == null || raw.isBlank()) {
                throw new SQLException("server_version_num is blank");
            }
            int versionNum = Integer.parseInt(raw.trim());
            return versionNum / 10000;
        } catch (NumberFormatException e) {
            throw new SQLException("Unexpected server_version_num format", e);
        }
    }

    private String resolvePgDumpBinary(int serverMajorVersion) throws Exception {
        Set<String> candidates = new LinkedHashSet<>();
        candidates.add("/opt/homebrew/opt/postgresql@" + serverMajorVersion + "/bin/pg_dump");
        candidates.add("/usr/local/opt/postgresql@" + serverMajorVersion + "/bin/pg_dump");
        candidates.add("pg_dump");
        candidates.add("/opt/homebrew/bin/pg_dump");
        candidates.add("/usr/local/bin/pg_dump");

        StringBuilder seen = new StringBuilder();
        for (String candidate : candidates) {
            Integer major = readPgDumpMajor(candidate);
            if (major == null) {
                continue;
            }
            if (seen.length() > 0) {
                seen.append(", ");
            }
            seen.append(candidate).append(" (v").append(major).append(')');
            if (major == serverMajorVersion) {
                return candidate;
            }
        }

        throw new IllegalStateException(
                "No compatible pg_dump found for PostgreSQL " + serverMajorVersion +
                        ". Detected: [" + seen + "]. Install/postgres toolchain for v" + serverMajorVersion +
                        " (for Homebrew: `brew install postgresql@" + serverMajorVersion + "`).");
    }

    private Integer readPgDumpMajor(String binary) {
        Process process = null;
        try {
            process = new ProcessBuilder(binary, "--version").start();
            String stdout;
            try (InputStream in = process.getInputStream()) {
                stdout = new String(in.readAllBytes(), StandardCharsets.UTF_8).trim();
            }
            String stderr;
            try (InputStream err = process.getErrorStream()) {
                stderr = new String(err.readAllBytes(), StandardCharsets.UTF_8).trim();
            }
            int exit = process.waitFor();
            if (exit != 0) {
                if (!stderr.isBlank()) {
                    log.debug("Skipping pg_dump candidate {} ({}).", binary, stderr);
                }
                return null;
            }
            int major = parsePgDumpMajor(stdout);
            return major > 0 ? major : null;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (process != null) {
                process.destroyForcibly();
            }
        }
    }

    private int parsePgDumpMajor(String versionOutput) {
        if (versionOutput == null || versionOutput.isBlank()) {
            return -1;
        }
        String[] tokens = versionOutput.split("\\s+");
        for (String token : tokens) {
            if (token.matches("\\d+(\\.\\d+)?")) {
                String major = token.split("\\.")[0];
                return Integer.parseInt(major);
            }
        }
        return -1;
    }

    private String normalizeDumpHost(String host) {
        if (host == null || host.isBlank()) {
            return "127.0.0.1";
        }
        if ("localhost".equalsIgnoreCase(host) || "::1".equals(host) || "[::1]".equals(host)) {
            return "127.0.0.1";
        }
        return host;
    }

    private String resolveDockerPostgresContainer() {
        Process process = null;
        try {
            process = new ProcessBuilder("docker", "ps", "--format", "{{.Names}}").start();
            String stdout;
            try (InputStream in = process.getInputStream()) {
                stdout = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
            process.waitFor();
            List<String> names = stdout.lines()
                    .map(String::trim)
                    .filter(line -> !line.isBlank())
                    .toList();
            if (names.isEmpty()) {
                return null;
            }
            for (String name : names) {
                if ("infra-postgres-1".equals(name)) {
                    return name;
                }
            }
            for (String name : names) {
                if (name.contains("postgres") && !name.contains("replica")) {
                    return name;
                }
            }
            for (String name : names) {
                if (name.contains("postgres")) {
                    return name;
                }
            }
            return null;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (process != null) {
                process.destroyForcibly();
            }
        }
    }

    private Map<String, Object> buildCleanupPreview(String scope, String namespace) throws Exception {
        try (Connection conn = databaseTarget().getConnection()) {
            List<Map<String, Object>> namespaces = new ArrayList<>();
            Map<String, Long> totals = new LinkedHashMap<>();

            if ("all".equals(scope)) {
                for (CleanupRepository.NamespaceSummary summary : CleanupRepository.listNamespaces(conn)) {
                    Map<String, Long> counts = CleanupRepository.preview(conn, summary.namespace());
                    long totalRows = counts.values().stream().mapToLong(Long::longValue).sum();
                    if (totalRows == 0 && summary.cleanedAt() != null) {
                        continue;
                    }
                    namespaces.add(Map.of(
                            "namespace", summary.namespace(),
                            "runCount", summary.runCount(),
                            "latestStatus", summary.latestStatus(),
                            "lastStartedAt", summary.lastStartedAt() != null ? summary.lastStartedAt().toString() : "",
                            "counts", counts,
                            "totalRows", totalRows
                    ));
                    mergeCounts(totals, counts);
                }
            } else {
                Map<String, Long> counts = CleanupRepository.preview(conn, namespace);
                long totalRows = counts.values().stream().mapToLong(Long::longValue).sum();
                namespaces.add(Map.of("namespace", namespace, "counts", counts, "totalRows", totalRows));
                mergeCounts(totals, counts);
            }

            return Map.of(
                    "scope", scope,
                    "namespaces", namespaces,
                    "totals", totals,
                    "totalRows", totals.values().stream().mapToLong(Long::longValue).sum()
            );
        }
    }

    private void executeCleanupJob(String scope, String namespace) {
        List<String> namespaces = new ArrayList<>();
        long startedAtMs = readLong(cleanupState.get().get("startedAtMs"), System.currentTimeMillis());
        String startedAt = Instant.ofEpochMilli(startedAtMs).toString();
        try (Connection conn = databaseTarget().getConnection()) {
            if ("all".equals(scope)) {
                for (CleanupRepository.NamespaceSummary summary : CleanupRepository.listNamespaces(conn)) {
                    Map<String, Long> counts = CleanupRepository.preview(conn, summary.namespace());
                    long totalRows = counts.values().stream().mapToLong(Long::longValue).sum();
                    if (totalRows > 0 || summary.cleanedAt() == null) {
                        namespaces.add(summary.namespace());
                    }
                }
            } else {
                namespaces.add(namespace);
            }
        } catch (Exception e) {
            cleanupState.set(Map.of("status", "error", "message", e.getMessage()));
            broadcast("cleanup-error", cleanupState.get());
            return;
        }

        long totalRowsDeleted = 0;
        Map<String, Map<String, Long>> deletedByNamespace = new LinkedHashMap<>();
        int stepCountPerNamespace = CleanupRepository.cleanupDeleteStepCount();
        int totalSteps = namespaces.size() * stepCountPerNamespace;

        Map<String, Object> startupProgress = new LinkedHashMap<>();
        startupProgress.put("status", "running");
        startupProgress.put("scope", scope);
        startupProgress.put("namespace", namespace != null ? namespace : "");
        startupProgress.put("startedAtMs", startedAtMs);
        startupProgress.put("startedAt", startedAt);
        startupProgress.put("completedNamespaces", 0);
        startupProgress.put("totalNamespaces", namespaces.size());
        startupProgress.put("completedSteps", 0);
        startupProgress.put("totalSteps", totalSteps);
        startupProgress.put("rowsDeleted", 0L);
        startupProgress.put("elapsedMs", 0L);
        cleanupState.set(startupProgress);
        broadcast("cleanup-progress", startupProgress);

        for (int i = 0; i < namespaces.size(); i++) {
            String currentNamespace = namespaces.get(i);
            final int completedNamespacesBefore = i;
            final long rowsDeletedBeforeNamespace = totalRowsDeleted;
            try (Connection conn = databaseTarget().getConnection()) {
                conn.setAutoCommit(false);
                try (PreparedStatement ps = conn.prepareStatement("SET LOCAL fern.simulator_cleanup = 'on'")) {
                    ps.execute();
                }
                Map<String, Long> deleted = CleanupRepository.execute(conn, currentNamespace, stepProgress -> {
                    long elapsedMs = Math.max(0L, System.currentTimeMillis() - startedAtMs);
                    int completedSteps = (completedNamespacesBefore * stepCountPerNamespace) + stepProgress.completedSteps();
                    Long etaMs = estimateEtaMs(elapsedMs, completedSteps, totalSteps);
                    Map<String, Object> progress = new LinkedHashMap<>();
                    progress.put("status", "running");
                    progress.put("scope", scope);
                    progress.put("namespace", namespace != null ? namespace : "");
                    progress.put("currentNamespace", currentNamespace);
                    progress.put("currentStep", stepProgress.step());
                    progress.put("startedAtMs", startedAtMs);
                    progress.put("startedAt", startedAt);
                    progress.put("completedNamespaces", completedNamespacesBefore);
                    progress.put("totalNamespaces", namespaces.size());
                    progress.put("completedSteps", completedSteps);
                    progress.put("totalSteps", totalSteps);
                    progress.put("rowsDeleted", rowsDeletedBeforeNamespace + stepProgress.cumulativeRowsDeleted());
                    progress.put("lastStepDeleted", stepProgress.stepRowsDeleted());
                    progress.put("elapsedMs", elapsedMs);
                    if (etaMs != null) {
                        progress.put("etaMs", etaMs);
                    }
                    cleanupState.set(progress);
                    broadcast("cleanup-progress", progress);
                });
                conn.commit();

                deletedByNamespace.put(currentNamespace, deleted);
                totalRowsDeleted += deleted.values().stream().mapToLong(Long::longValue).sum();
                long elapsedMs = Math.max(0L, System.currentTimeMillis() - startedAtMs);
                int completedSteps = Math.min(totalSteps, (i + 1) * stepCountPerNamespace);
                Long etaMs = estimateEtaMs(elapsedMs, completedSteps, totalSteps);

                Map<String, Object> progress = new LinkedHashMap<>();
                progress.put("status", "running");
                progress.put("scope", scope);
                progress.put("namespace", namespace != null ? namespace : "");
                progress.put("currentNamespace", currentNamespace);
                progress.put("startedAtMs", startedAtMs);
                progress.put("startedAt", startedAt);
                progress.put("completedNamespaces", i + 1);
                progress.put("totalNamespaces", namespaces.size());
                progress.put("completedSteps", completedSteps);
                progress.put("totalSteps", totalSteps);
                progress.put("rowsDeleted", totalRowsDeleted);
                progress.put("lastDeleted", deleted);
                progress.put("elapsedMs", elapsedMs);
                if (etaMs != null) {
                    progress.put("etaMs", etaMs);
                }
                cleanupState.set(progress);
                broadcast("cleanup-progress", progress);
            } catch (Exception e) {
                long elapsedMs = Math.max(0L, System.currentTimeMillis() - startedAtMs);
                Map<String, Object> error = new LinkedHashMap<>();
                error.put("status", "error");
                error.put("scope", scope);
                error.put("namespace", namespace != null ? namespace : "");
                error.put("currentNamespace", currentNamespace);
                error.put("startedAtMs", startedAtMs);
                error.put("startedAt", startedAt);
                error.put("completedNamespaces", i);
                error.put("totalNamespaces", namespaces.size());
                error.put("completedSteps", Math.min(totalSteps, i * stepCountPerNamespace));
                error.put("totalSteps", totalSteps);
                error.put("rowsDeleted", totalRowsDeleted);
                error.put("deletedByNamespace", deletedByNamespace);
                error.put("elapsedMs", elapsedMs);
                error.put("message", e.getMessage());
                cleanupState.set(error);
                broadcast("cleanup-error", error);
                return;
            }
        }

        long elapsedMs = Math.max(0L, System.currentTimeMillis() - startedAtMs);
        long rowsPerSecond = elapsedMs > 0 ? Math.round((totalRowsDeleted * 1000.0d) / elapsedMs) : 0L;
        Map<String, Object> complete = new LinkedHashMap<>();
        complete.put("status", "complete");
        complete.put("scope", scope);
        complete.put("namespace", namespace != null ? namespace : "");
        complete.put("startedAtMs", startedAtMs);
        complete.put("startedAt", startedAt);
        complete.put("completedNamespaces", namespaces.size());
        complete.put("totalNamespaces", namespaces.size());
        complete.put("completedSteps", totalSteps);
        complete.put("totalSteps", totalSteps);
        complete.put("rowsDeleted", totalRowsDeleted);
        complete.put("elapsedMs", elapsedMs);
        complete.put("rowsPerSecond", rowsPerSecond);
        complete.put("deletedByNamespace", deletedByNamespace);
        cleanupState.set(complete);
        broadcast("cleanup-complete", complete);
    }

    private Long estimateEtaMs(long elapsedMs, int completedSteps, int totalSteps) {
        if (elapsedMs <= 0 || completedSteps <= 0 || totalSteps <= 0) {
            return null;
        }
        if (completedSteps >= totalSteps) {
            return 0L;
        }
        long projectedTotalMs = Math.round((double) elapsedMs * totalSteps / completedSteps);
        return Math.max(0L, projectedTotalMs - elapsedMs);
    }

    private long readLong(Object value, long fallback) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value instanceof String raw) {
            try {
                return Long.parseLong(raw);
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private void mergeCounts(Map<String, Long> totals, Map<String, Long> counts) {
        for (var entry : counts.entrySet()) {
            totals.merge(entry.getKey(), entry.getValue(), Long::sum);
        }
    }

    private Object parseJsonColumn(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return MAPPER.readValue(json, Map.class);
        } catch (Exception ignored) {
            return Map.of("raw", json);
        }
    }

    private Map<String, String> parseQuery(String rawQuery) {
        Map<String, String> query = new LinkedHashMap<>();
        if (rawQuery == null || rawQuery.isBlank()) {
            return query;
        }
        for (String pair : rawQuery.split("&")) {
            String[] parts = pair.split("=", 2);
            if (parts.length == 2) {
                query.put(parts[0], java.net.URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
            }
        }
        return query;
    }

    private void broadcast(String event, Object data) {
        String json;
        try {
            json = MAPPER.writeValueAsString(data);
        } catch (Exception e) {
            json = "{}";
        }

        byte[] bytes = ("event: " + event + "\ndata: " + json + "\n\n").getBytes(StandardCharsets.UTF_8);
        for (OutputStream os : sseClients) {
            try {
                os.write(bytes);
                os.flush();
            } catch (IOException e) {
                sseClients.remove(os);
            }
        }
    }

    private class GuiProgressListener implements ProgressListener {
        @Override
        public void onStart(String namespace, long totalDays, LocalDate startDate, LocalDate endDate) {
            broadcast("start", Map.of(
                    "namespace", namespace,
                    "totalDays", totalDays,
                    "startDate", startDate.toString(),
                    "endDate", endDate.toString()
            ));
        }

        @Override
        public void onDayComplete(long day, long totalDays, LocalDate date, int outlets, int employees,
                                  long revenue, int sales, long rows) {
            broadcast("day", Map.of(
                    "day", day,
                    "totalDays", totalDays,
                    "date", date.toString(),
                    "outlets", outlets,
                    "employees", employees,
                    "revenue", revenue,
                    "sales", sales,
                    "rows", rows
            ));
        }

        @Override
        public void onMonthEnd(int year, int month, long revenue, int outlets, int employees,
                               int sales, int purchaseOrders, long cogs, long payrollCost,
                               long operatingCost, long grossProfit, long netProfit,
                               long wasteCost, long lostSalesValue) {
            broadcast("month", Map.ofEntries(
                    Map.entry("year", year),
                    Map.entry("month", month),
                    Map.entry("revenue", revenue),
                    Map.entry("outlets", outlets),
                    Map.entry("employees", employees),
                    Map.entry("sales", sales),
                    Map.entry("purchaseOrders", purchaseOrders),
                    Map.entry("cogs", cogs),
                    Map.entry("payrollCost", payrollCost),
                    Map.entry("operatingCost", operatingCost),
                    Map.entry("grossProfit", grossProfit),
                    Map.entry("netProfit", netProfit),
                    Map.entry("wasteCost", wasteCost),
                    Map.entry("lostSalesValue", lostSalesValue)
            ));
        }

        @Override
        public void onDiagnostics(Map<String, Object> diagnostics) {
            latestDiagnostics.set(diagnostics);
            broadcast("diagnostics", diagnostics);
        }

        @Override
        public void onOperationalSummary(Map<String, Object> summary) {
            broadcast("operational", summary);
        }

        @Override
        public void onComplete(Map<String, Long> rowCounts, long totalRevenue, int totalEmployees,
                               int activeEmployees, int totalOutlets, int activeOutlets) {
            broadcast("complete", Map.of(
                    "rowCounts", rowCounts,
                    "totalRevenue", totalRevenue,
                    "totalEmployees", totalEmployees,
                    "activeEmployees", activeEmployees,
                    "totalOutlets", totalOutlets,
                    "activeOutlets", activeOutlets
            ));
        }

        @Override
        public void onError(String message) {
            broadcast("error", Map.of("message", message));
        }
    }
}
