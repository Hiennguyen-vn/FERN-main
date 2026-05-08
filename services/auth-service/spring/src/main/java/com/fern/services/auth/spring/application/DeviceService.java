package com.fern.services.auth.spring.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.spring.auth.OutletScopeContext;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.auth.spring.api.AuthDtos;
import com.fern.services.auth.spring.infrastructure.DeviceRepository;
import com.fern.services.auth.spring.infrastructure.DeviceRepository.DeviceRecord;
import com.fern.services.auth.spring.infrastructure.DeviceRepository.PairTokenRecord;
import com.fern.common.utils.security.TokenUtil;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class DeviceService {

  private static final long PAIR_TOKEN_TTL_SECONDS = 300; // 5 min QR window

  private final DeviceRepository deviceRepository;
  private final JwtTokenService jwtTokenService;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final Clock clock;
  private final long deviceTokenTtlSeconds;

  public DeviceService(
      DeviceRepository deviceRepository,
      JwtTokenService jwtTokenService,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      @Value("${security.device-token.ttl-seconds:7776000}") long deviceTokenTtlSeconds
  ) {
    this.deviceRepository = deviceRepository;
    this.jwtTokenService = jwtTokenService;
    this.authorizationPolicyService = authorizationPolicyService;
    this.clock = clock;
    this.deviceTokenTtlSeconds = deviceTokenTtlSeconds;
  }

  /** Manager (user-JWT) creates a short-lived pair token for one device. */
  public AuthDtos.DevicePairTokenResponse issuePairToken(AuthDtos.DevicePairTokenRequest request) {
    RequestUserContext ctx = RequestUserContextHolder.get();
    if (!authorizationPolicyService.canWriteSalesForOutlet(ctx, request.outletId())) {
      throw ServiceException.forbidden(
          "Device pair token issuance denied: no write-sales access for outlet " + request.outletId());
    }
    long issuedBy = ctx.requireUserId();

    String rawToken = TokenUtil.generateRandomToken(32);
    String tokenHash = sha256(rawToken);
    Instant expiresAt = clock.instant().plusSeconds(PAIR_TOKEN_TTL_SECONDS);

    long pairTokenId = deviceRepository.insertPairToken(
        request.outletId(), tokenHash, request.deviceLabel(),
        request.workerId(), issuedBy, expiresAt
    );

    return new AuthDtos.DevicePairTokenResponse(
        pairTokenId, rawToken, request.outletId(), request.deviceLabel(), expiresAt
    );
  }

  /** Edge agent redeems pair token → receives long-lived device-JWT. */
  public AuthDtos.DeviceTokenResponse redeemPairToken(AuthDtos.DeviceRedeemRequest request) {
    String tokenHash = sha256(request.pairToken());
    PairTokenRecord pair = deviceRepository.findPairTokenByHash(tokenHash)
        .orElseThrow(() -> ServiceException.unauthorized("Invalid pair token"));

    if (pair.usedAt() != null) {
      throw ServiceException.conflict("Pair token already used");
    }
    if (pair.expiresAt().isBefore(clock.instant())) {
      throw ServiceException.unauthorized("Pair token expired");
    }

    Instant tokenExpiresAt = clock.instant().plusSeconds(deviceTokenTtlSeconds);
    String deviceToken = jwtTokenService.issueDeviceToken(
        0L, pair.outletId(), deviceTokenTtlSeconds // placeholder id; resolved after upsert
    );

    // Redeem atomically (marks used + upserts device_registry)
    // We need real deviceId from DB; issue token after we have it
    String deviceTokenHash = sha256(deviceToken);
    DeviceRecord device = withOutletScope(
        pair.outletId(),
        () -> deviceRepository.redeemPairToken(pair.id(), deviceTokenHash, tokenExpiresAt)
    );

    // Re-issue with actual deviceId
    String finalToken = jwtTokenService.issueDeviceToken(device.id(), device.outletId(), deviceTokenTtlSeconds);
    String finalTokenHash = sha256(finalToken);
    withOutletScope(pair.outletId(), () -> {
      deviceRepository.updateDeviceToken(device.id(), finalTokenHash, tokenExpiresAt);
      return null;
    });

    return new AuthDtos.DeviceTokenResponse(
      device.id(), device.outletId(), device.deviceLabel(),
      device.workerId(), finalToken, deviceTokenTtlSeconds, tokenExpiresAt, device.pairedAt()
    );
  }

  /** Edge agent refreshes its device-JWT. Must be called with a valid (non-expired) device-JWT. */
  public AuthDtos.DeviceRefreshResponse refreshDeviceToken() {
    RequestUserContext ctx = resolveDeviceContext();
    long deviceId = ctx.deviceId();

    DeviceRecord device = deviceRepository.findActiveDeviceById(deviceId)
        .orElseThrow(() -> ServiceException.unauthorized("Device revoked or not found"));

    Instant newExpiresAt = clock.instant().plusSeconds(deviceTokenTtlSeconds);
    String newToken = jwtTokenService.issueDeviceToken(device.id(), device.outletId(), deviceTokenTtlSeconds);
    String newTokenHash = sha256(newToken);
    deviceRepository.updateDeviceToken(device.id(), newTokenHash, newExpiresAt);

    return new AuthDtos.DeviceRefreshResponse(
        device.id(), device.outletId(), newToken, deviceTokenTtlSeconds, newExpiresAt
    );
  }

  /** Manager revokes a device permanently. */
  public void revokeDevice(long deviceId) {
    deviceRepository.revokeDevice(deviceId);
  }

  private RequestUserContext resolveDeviceContext() {
    RequestUserContext ctx = RequestUserContextHolder.get();
    if (!ctx.isDeviceContext()) {
      throw ServiceException.unauthorized("Device JWT required");
    }
    return ctx;
  }

  static String sha256(String input) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hash);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private static <T> T withOutletScope(long outletId, Supplier<T> work) {
    OutletScopeContext.ScopeSnapshot previousScope = OutletScopeContext.snapshot();
    try {
      OutletScopeContext.set(outletId);
      return work.get();
    } finally {
      OutletScopeContext.restore(previousScope);
    }
  }
}
