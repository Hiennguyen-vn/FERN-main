package com.fern.services.masternode.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class ControlPlaneDtos {

  private ControlPlaneDtos() {
  }

  public record ServiceRegistrationRequest(
      Long instanceId,
      @NotBlank String serviceName,
      @NotBlank String version,
      @NotBlank String runtime,
      @NotBlank String host,
      @NotNull @Min(1) @Max(65535) Integer port,
      List<String> regionCodes,
      List<Long> outletIds,
      List<String> capabilities,
      Map<String, Object> metadata
  ) {
  }

  public record ServiceRegistrationResponse(
      long instanceId,
      int leaseTtlSeconds,
      long effectiveConfigVersion,
      String heartbeatPath
  ) {
  }

  public record MasterHeartbeatRequest(
      Long instanceId,
      @NotBlank String serviceName,
      @NotBlank String version,
      @NotBlank String runtime,
      @NotBlank String host,
      @NotNull @Min(1) @Max(65535) Integer port,
      List<String> regionCodes,
      List<Long> outletIds,
      List<String> capabilities,
      Map<String, Object> metadata,
      String status
  ) {
  }

  public record MasterHeartbeatResponse(
      long instanceId,
      String status,
      int leaseTtlSeconds
  ) {
  }

  public record ServiceHeartbeatRequest(
      String status,
      Instant startedAt,
      Integer inFlightRequests,
      Double cpuLoad,
      Long memoryUsage,
      Long observedConfigVersion
  ) {
  }

  public record ServiceHeartbeatResponse(
      boolean accepted,
      int nextHeartbeatSeconds
  ) {
  }

  public record ServiceDeregisterRequest(
      String reason,
      Integer drainTimeoutSeconds
  ) {
  }

  public record ServiceSummaryView(
      String serviceName,
      long activeInstances,
      long inactiveInstances,
      List<String> versions
  ) {
  }

  public record ServiceInstanceView(
      long instanceId,
      String serviceName,
      String version,
      String runtime,
      String host,
      int port,
      String status,
      Instant registeredAt,
      Instant lastHeartbeatAt,
      List<String> regionCodes,
      List<Long> outletIds,
      List<String> capabilities,
      Map<String, Object> metadata,
      boolean active
  ) {
  }

  public record EffectiveConfigResponse(
      String serviceName,
      long configVersion,
      String etag,
      Map<String, Object> properties,
      Map<String, Boolean> featureFlags
  ) {
  }

  public record AssignmentView(
      long assignmentId,
      String serviceName,
      String regionCode,
      Long outletId,
      int desiredInstances,
      int routingWeight,
      boolean active
  ) {
  }

  public record ServiceAssignmentsResponse(
      String serviceName,
      List<AssignmentView> assignments
  ) {
  }

  public record InstanceHealthView(
      long instanceId,
      String status,
      Instant lastHeartbeatAt,
      boolean active,
      String reason
  ) {
  }

  public record ServiceHealthResponse(
      String serviceName,
      List<InstanceHealthView> instances
  ) {
  }

  public record SystemHealthResponse(
      String status,
      int leaseTtlSeconds,
      int heartbeatIntervalSeconds,
      long activeInstances,
      long degradedInstances,
      long downInstances,
      List<ServiceSummaryView> services
  ) {
  }

  public record CreateReleaseRequest(
      @NotBlank String serviceName,
      @NotBlank String version,
      @NotBlank String imageRef,
      String changeSummary,
      @NotBlank String createdBy
  ) {
  }

  public record CreateReleaseResponse(
      long releaseId,
      String status
  ) {
  }

  public record CreateRolloutRequest(
      @NotEmpty List<Long> assignmentIds,
      @NotBlank String strategy,
      @Min(1) Integer batchSize,
      @Min(0) Integer maxUnavailable,
      String approvalRef
  ) {
  }

  public record CreateRolloutResponse(
      long rolloutId,
      String stage,
      boolean accepted
  ) {
  }

  public record RolloutView(
      long rolloutId,
      String stage,
      String desiredState,
      String actualState,
      List<Long> assignmentIds,
      Instant startedAt,
      Instant completedAt,
      String approvalRef,
      String errorSummary
  ) {
  }

  public record ReleaseView(
      long releaseId,
      String serviceName,
      String version,
      String imageRef,
      String status,
      String changeSummary,
      String createdBy,
      Instant createdAt,
      List<RolloutView> rollouts
  ) {
  }
}
