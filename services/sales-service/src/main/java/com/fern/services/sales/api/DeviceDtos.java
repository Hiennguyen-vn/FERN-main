package com.fern.services.sales.api;

public class DeviceDtos {

  public record ProvisionRequest(
      long outletId,
      String deviceLabel,
      String browserFingerprintHash  // nullable
  ) {}

  public record ProvisionResponse(
      long deviceId,
      int workerId
  ) {}
}
