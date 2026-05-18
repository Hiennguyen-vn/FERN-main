package com.fern.services.auth.spring.api;

import com.fern.services.auth.spring.application.DeviceService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/devices")
public class DeviceController {

  private final DeviceService deviceService;

  public DeviceController(DeviceService deviceService) {
    this.deviceService = deviceService;
  }

  /** Manager (user-JWT) issues a short-lived QR pair token for a device. */
  @PostMapping("/pair-token")
  @ResponseStatus(HttpStatus.CREATED)
  public AuthDtos.DevicePairTokenResponse issuePairToken(
      @Valid @RequestBody AuthDtos.DevicePairTokenRequest request
  ) {
    return deviceService.issuePairToken(request);
  }

  /** Device client redeems pair token and gets a long-lived device JWT. */
  @PostMapping("/pair")
  public AuthDtos.DeviceTokenResponse redeemPairToken(
      @Valid @RequestBody AuthDtos.DeviceRedeemRequest request
  ) {
    return deviceService.redeemPairToken(request);
  }

  /** Device client refreshes its device JWT before expiry. Must present current device JWT. */
  @PostMapping("/refresh")
  public AuthDtos.DeviceRefreshResponse refreshDeviceToken() {
    return deviceService.refreshDeviceToken();
  }

  /** Manager revokes a device. Subsequent pushes from that device → 401. */
  @DeleteMapping("/{deviceId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void revokeDevice(@PathVariable long deviceId) {
    deviceService.revokeDevice(deviceId);
  }
}
