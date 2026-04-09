package com.natsu.common.utils.security;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * Payload carried inside an opaque asymmetric token.
 * Only the auth service (issuer) and backend services (verifier) can read this;
 * clients receive an opaque token string and cannot decrypt or parse it.
 */
public final class OpaqueTokenPayload {

    private final String subject;
    private final String username;
    private final List<String> permissions;
    private final long issuedAtMs;
    private final long expiresAtMs;

    @JsonCreator
    public OpaqueTokenPayload(
            @JsonProperty("sub") String subject,
            @JsonProperty("username") String username,
            @JsonProperty("permissions") List<String> permissions,
            @JsonProperty("iat") long issuedAtMs,
            @JsonProperty("exp") long expiresAtMs) {
        this.subject = Objects.requireNonNull(subject, "subject");
        this.username = Objects.requireNonNull(username, "username");
        this.permissions = permissions != null ? List.copyOf(permissions) : Collections.emptyList();
        this.issuedAtMs = issuedAtMs;
        this.expiresAtMs = expiresAtMs;
    }

    @JsonProperty("sub")
    public String getSubject() {
        return subject;
    }

    @JsonProperty("username")
    public String getUsername() {
        return username;
    }

    @JsonProperty("permissions")
    public List<String> getPermissions() {
        return permissions;
    }

    @JsonProperty("iat")
    public long getIssuedAtMs() {
        return issuedAtMs;
    }

    @JsonProperty("exp")
    public long getExpiresAtMs() {
        return expiresAtMs;
    }

    public boolean hasPermission(String permission) {
        return permissions.contains(permission);
    }
}
