package com.fern.services.auth.spring.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.spring.auth.OutletScopeContext;
import com.fern.services.auth.spring.api.AuthDtos;
import com.fern.services.auth.spring.infrastructure.DeviceRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class DeviceServiceTest {

  private static final String JWT_SECRET = "test-jwt-secret-should-be-at-least-32-bytes";

  private final Clock clock = Clock.fixed(Instant.parse("2026-05-06T10:15:00Z"), ZoneOffset.UTC);
  private final JwtTokenService jwtTokenService =
      new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET);

  @AfterEach
  void clearOutletScope() {
    OutletScopeContext.clear();
  }

  @Test
  void redeemPairTokenAppliesOutletScopeForRlsProtectedDeviceRegistryWrites() {
    DeviceRepository deviceRepository = mock(DeviceRepository.class);
    AuthorizationPolicyService authorizationPolicyService = mock(AuthorizationPolicyService.class);
    DeviceService service = new DeviceService(
        deviceRepository,
        jwtTokenService,
        authorizationPolicyService,
        clock,
        3600L
    );

    String pairToken = "pair-token";
    String pairTokenHash = DeviceService.sha256(pairToken);
    Instant expiresAt = clock.instant().plusSeconds(300);
    Instant deviceTokenExpiresAt = clock.instant().plusSeconds(3600);
    long outletId = 3485603532616777729L;
    long deviceId = 3487050784233754624L;

    when(deviceRepository.findPairTokenByHash(pairTokenHash)).thenReturn(java.util.Optional.of(
        new DeviceRepository.PairTokenRecord(
            91L,
            outletId,
            pairTokenHash,
            "codex-device",
            133,
            9001L,
            expiresAt,
            null
        )
    ));
    when(deviceRepository.redeemPairToken(eq(91L), any(), eq(deviceTokenExpiresAt))).thenAnswer(invocation -> {
      assertEquals(outletId, OutletScopeContext.get());
      return new DeviceRepository.DeviceRecord(
          deviceId,
          outletId,
          "codex-device",
          133,
          invocation.getArgument(1),
          deviceTokenExpiresAt,
          clock.instant(),
          null,
          clock.instant()
      );
    });
    doAnswer(invocation -> {
      assertEquals(outletId, OutletScopeContext.get());
      return null;
    }).when(deviceRepository).updateDeviceToken(eq(deviceId), any(), eq(deviceTokenExpiresAt));

    OutletScopeContext.set(77L);

    AuthDtos.DeviceTokenResponse response =
        service.redeemPairToken(new AuthDtos.DeviceRedeemRequest(pairToken));

    assertEquals(deviceId, response.deviceId());
    assertEquals(outletId, response.outletId());
    assertEquals("codex-device", response.deviceLabel());
    assertEquals(133, response.workerId());
    assertEquals(77L, OutletScopeContext.get());
    verify(deviceRepository).findPairTokenByHash(pairTokenHash);
    verify(deviceRepository).redeemPairToken(eq(91L), any(), eq(deviceTokenExpiresAt));
    verify(deviceRepository).updateDeviceToken(eq(deviceId), any(), eq(deviceTokenExpiresAt));
  }
}
