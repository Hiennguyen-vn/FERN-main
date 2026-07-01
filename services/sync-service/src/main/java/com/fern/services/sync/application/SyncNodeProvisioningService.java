package com.fern.services.sync.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.state.SyncRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class SyncNodeProvisioningService {

  private static final SecureRandom SECURE_RANDOM = new SecureRandom();

  private final SyncRepository syncRepository;
  private final SnowflakeIdGenerator snowflakeIdGenerator;
  private final JwtTokenService jwtTokenService;
  private final Clock clock;
  private final long tokenTtlSeconds;

  public SyncNodeProvisioningService(
      SyncRepository syncRepository,
      SnowflakeIdGenerator snowflakeIdGenerator,
      JwtTokenService jwtTokenService,
      Clock clock,
      @Value("${sync.node-token-ttl-seconds:7776000}") long tokenTtlSeconds
  ) {
    this.syncRepository = syncRepository;
    this.snowflakeIdGenerator = snowflakeIdGenerator;
    this.jwtTokenService = jwtTokenService;
    this.clock = clock;
    this.tokenTtlSeconds = tokenTtlSeconds;
  }

  public SyncDtos.ProvisionSyncNodeResponse provision(SyncDtos.ProvisionSyncNodeRequest request) {
    String nodeId = "sync-node-" + UUID.randomUUID();
    String clientSecret = generateSecret();
    long deviceId = snowflakeIdGenerator.generateId();
    int workerId = request.workerId() == null ? deriveWorkerId(request.nodeCode()) : request.workerId();
    SyncRepository.ProvisionedNodeRow node = syncRepository.provisionNode(
        nodeId,
        request.storeId(),
        request.nodeCode().trim(),
        request.nodeName().trim(),
        normalizeNodeType(request.nodeType()),
        deviceId,
        workerId,
        sha256(clientSecret),
        blankToNull(request.hardwareFingerprint()),
        blankToNull(request.publicKey())
    );
    return new SyncDtos.ProvisionSyncNodeResponse(
        node.id(),
        node.storeId(),
        node.nodeCode(),
        node.deviceId(),
        node.workerId(),
        clientSecret
    );
  }

  public SyncDtos.SyncHandshakeResponse handshake(SyncDtos.SyncHandshakeRequest request) {
    SyncRepository.ProvisionedNodeRow node = syncRepository
        .findProvisionedNode(request.nodeId(), request.storeId())
        .orElseThrow(() -> ServiceException.unauthorized("Invalid sync node"));
    if (!MessageDigest.isEqual(
        node.clientSecretHash().getBytes(StandardCharsets.UTF_8),
        sha256(request.clientSecret()).getBytes(StandardCharsets.UTF_8))) {
      throw ServiceException.unauthorized("Invalid sync node credential");
    }
    Instant expiresAt = clock.instant().plusSeconds(tokenTtlSeconds);
    String token = jwtTokenService.issueDeviceToken(node.deviceId(), node.storeId(), tokenTtlSeconds);
    syncRepository.registerNodeDeviceToken(
        node.deviceId(),
        node.storeId(),
        node.nodeName(),
        node.workerId(),
        sha256(token),
        expiresAt
    );
    return new SyncDtos.SyncHandshakeResponse(
        node.id(),
        node.storeId(),
        node.deviceId(),
        token,
        tokenTtlSeconds,
        expiresAt
    );
  }

  public SyncDtos.RotateSyncNodeSecretResponse rotateSecret(String nodeId) {
    String clientSecret = generateSecret();
    SyncRepository.ProvisionedNodeRow node = syncRepository.rotateNodeSecret(nodeId, sha256(clientSecret));
    return new SyncDtos.RotateSyncNodeSecretResponse(
        node.id(),
        node.storeId(),
        node.deviceId(),
        clientSecret
    );
  }

  public void revoke(String nodeId) {
    syncRepository.revokeNode(nodeId);
  }

  private static String normalizeNodeType(String nodeType) {
    if (nodeType == null || nodeType.isBlank()) {
      return "STORE_EDGE";
    }
    return switch (nodeType.trim().toUpperCase(Locale.ROOT)) {
      case "CENTRAL", "BACKOFFICE" -> nodeType.trim().toUpperCase(Locale.ROOT);
      default -> "STORE_EDGE";
    };
  }

  private static int deriveWorkerId(String nodeCode) {
    int hash = Math.abs((nodeCode == null ? "sync-node" : nodeCode).hashCode());
    return 128 + (hash % 896);
  }

  private static String generateSecret() {
    byte[] bytes = new byte[32];
    SECURE_RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private static String sha256(String input) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(md.digest(input.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }
}
