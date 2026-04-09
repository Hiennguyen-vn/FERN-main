package com.dorabets.common.auth;

import com.dorabets.common.config.RuntimeEnvironment;
import com.dorabets.common.middleware.ServiceException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * Shared service token verifier factory with explicit dev-only fallback.
 */
public final class ServiceTokenVerifierFactory {

    private ServiceTokenVerifierFactory() {
    }

    public static TokenVerifier create(ObjectMapper objectMapper, String serviceName) {
        String sidecarUrl = firstNonBlank(
                System.getenv("TOKEN_VERIFIER_URL"),
                System.getenv("TOKEN_SIDECAR_URL")
        );
        if (sidecarUrl != null) {
            return new SidecarTokenVerifier(sidecarUrl, objectMapper);
        }
        if (RuntimeEnvironment.isDevelopment()) {
            return new ExplicitDevTokenVerifier(objectMapper, serviceName);
        }
        throw new IllegalStateException(
                "Token verification sidecar is required for " + serviceName
                        + " unless the process is started with " + RuntimeEnvironment.DEV_FLAG
        );
    }

    private static final class SidecarTokenVerifier implements TokenVerifier {
        private final String verifyUrl;
        private final ObjectMapper mapper;
        private final HttpClient httpClient;

        private SidecarTokenVerifier(String baseUrl, ObjectMapper mapper) {
            this.verifyUrl = baseUrl.endsWith("/verify") ? baseUrl : baseUrl.replaceAll("/+$", "") + "/verify";
            this.mapper = mapper;
            this.httpClient = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(3))
                    .build();
        }

        @Override
        public TokenClaims verify(String opaqueToken) {
            try {
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(verifyUrl))
                        .header("Authorization", "Bearer " + opaqueToken)
                        .GET()
                        .timeout(Duration.ofSeconds(5))
                        .build();
                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 200) {
                    throw new ServiceException(401, "unauthorized", "Token verification failed");
                }
                return mapper.readValue(response.body(), TokenClaims.class);
            } catch (ServiceException e) {
                throw e;
            } catch (Exception e) {
                throw new ServiceException(401, "unauthorized", "Token verification error: " + e.getMessage());
            }
        }
    }

    private static final class ExplicitDevTokenVerifier implements TokenVerifier {
        private final ObjectMapper mapper;
        private final String serviceName;

        private ExplicitDevTokenVerifier(ObjectMapper mapper, String serviceName) {
            this.mapper = mapper;
            this.serviceName = serviceName;
        }

        @SuppressWarnings("unchecked")
        @Override
        public TokenClaims verify(String opaqueToken) {
            if (opaqueToken == null || opaqueToken.isBlank()) {
                throw ServiceException.unauthorized("Missing authentication token");
            }

            try {
                String json = opaqueToken.trim();
                if (!json.startsWith("{")) {
                    byte[] decoded = Base64.getUrlDecoder().decode(opaqueToken);
                    json = new String(decoded, java.nio.charset.StandardCharsets.UTF_8);
                }

                Map<String, Object> payload = mapper.readValue(json, Map.class);
                String userId = readText(payload, "userId", "user_id");
                if (userId == null || userId.isBlank()) {
                    throw ServiceException.unauthorized("Invalid dev token");
                }
                long expiresAt = payload.containsKey("expiresAt")
                        ? normalizeEpochMillis(((Number) payload.get("expiresAt")).longValue())
                        : Long.MAX_VALUE;
                if (expiresAt < System.currentTimeMillis()) {
                    throw new ServiceException(401, "token_expired", "Token has expired");
                }
                List<String> roles = payload.containsKey("roles")
                        ? (List<String>) payload.get("roles")
                        : List.of("player");
                List<String> permissions = payload.containsKey("permissions")
                        ? (List<String>) payload.get("permissions")
                        : List.of();

                return new TokenClaims(
                        userId,
                        readText(payload, "sessionId", "session_id"),
                        roles,
                        permissions,
                        readText(payload, "deviceId", "device_id"),
                        firstNonBlank(readText(payload, "tenantId", "tenant_id"), "default"),
                        payload.containsKey("policyVersion")
                                ? ((Number) payload.get("policyVersion")).intValue()
                                : 1,
                        expiresAt
                );
            } catch (ServiceException e) {
                throw e;
            } catch (Exception e) {
                throw ServiceException.unauthorized(
                        "Invalid dev token for " + serviceName + "; expected base64url JSON claims"
                );
            }
        }

        private static long normalizeEpochMillis(long raw) {
            if (raw <= 0) {
                return raw;
            }
            return raw < 100_000_000_000L ? raw * 1_000L : raw;
        }

        private static String readText(Map<String, Object> payload, String... keys) {
            for (String key : keys) {
                Object value = payload.get(key);
                if (value instanceof String text && !text.isBlank()) {
                    return text;
                }
            }
            return null;
        }
    }

    private static String firstNonBlank(String... values) {
        if (values == null) {
            return null;
        }
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }
}
