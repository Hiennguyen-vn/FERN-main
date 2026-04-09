package com.fern.services.masternode.api;

import com.fern.services.masternode.application.ControlPlaneRegistryService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping
public class ControlPlaneController {

  private final ControlPlaneRegistryService registryService;

  public ControlPlaneController(ControlPlaneRegistryService registryService) {
    this.registryService = registryService;
  }

  @PostMapping("/api/v1/control/services/register")
  @ResponseStatus(HttpStatus.CREATED)
  public ControlPlaneDtos.ServiceRegistrationResponse register(
      @Valid @RequestBody ControlPlaneDtos.ServiceRegistrationRequest request
  ) {
    return registryService.register(request);
  }

  @PostMapping("/api/v1/control/services/{instanceId}/heartbeat")
  public ControlPlaneDtos.ServiceHeartbeatResponse heartbeat(
      @PathVariable long instanceId,
      @RequestBody(required = false) ControlPlaneDtos.ServiceHeartbeatRequest request
  ) {
    ControlPlaneDtos.ServiceHeartbeatRequest payload = request == null
        ? new ControlPlaneDtos.ServiceHeartbeatRequest(null, null, null, null, null, null)
        : request;
    return registryService.heartbeat(instanceId, payload);
  }

  @PostMapping("/api/v1/master/heartbeat")
  public ControlPlaneDtos.MasterHeartbeatResponse masterHeartbeat(
      @Valid @RequestBody ControlPlaneDtos.MasterHeartbeatRequest request
  ) {
    return registryService.upsertHeartbeat(request);
  }

  @GetMapping("/api/v1/master/registry/{serviceName}")
  public List<ControlPlaneDtos.ServiceInstanceView> registry(@PathVariable String serviceName) {
    return registryService.discovery(serviceName);
  }

  @PostMapping("/api/v1/control/services/{instanceId}/deregister")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public void deregister(
      @PathVariable long instanceId,
      @RequestBody(required = false) ControlPlaneDtos.ServiceDeregisterRequest request
  ) {
    ControlPlaneDtos.ServiceDeregisterRequest payload = request == null
        ? new ControlPlaneDtos.ServiceDeregisterRequest("shutdown", 0)
        : request;
    registryService.deregister(instanceId, payload);
  }

  @GetMapping("/api/v1/control/services")
  public List<ControlPlaneDtos.ServiceSummaryView> listServices() {
    return registryService.listServices();
  }

  @GetMapping({"/api/v1/control/services/{serviceName}/instances", "/api/v1/master/services/{serviceName}/instances"})
  public List<ControlPlaneDtos.ServiceInstanceView> listInstances(
      @PathVariable String serviceName,
      @RequestParam(required = false) String regionCode,
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String capability
  ) {
    return registryService.listInstances(serviceName, regionCode, outletId, capability);
  }

  @GetMapping({"/api/v1/control/config/{serviceName}", "/api/v1/master/config/{serviceName}"})
  public ControlPlaneDtos.EffectiveConfigResponse getConfig(@PathVariable String serviceName) {
    return registryService.getConfig(serviceName);
  }

  @GetMapping({"/api/v1/control/assignments/{serviceName}", "/api/v1/master/assignments/{serviceName}"})
  public ControlPlaneDtos.ServiceAssignmentsResponse getAssignments(@PathVariable String serviceName) {
    return registryService.getAssignments(serviceName);
  }

  @GetMapping({"/api/v1/control/health/system", "/api/v1/master/health/system"})
  public ControlPlaneDtos.SystemHealthResponse systemHealth() {
    return registryService.systemHealth();
  }

  @GetMapping({"/api/v1/control/health/services/{serviceName}", "/api/v1/master/health/services/{serviceName}"})
  public ControlPlaneDtos.ServiceHealthResponse serviceHealth(@PathVariable String serviceName) {
    return registryService.serviceHealth(serviceName);
  }

  @PostMapping({"/api/v1/control/releases", "/api/v1/master/releases"})
  @ResponseStatus(HttpStatus.CREATED)
  public ControlPlaneDtos.CreateReleaseResponse createRelease(
      @Valid @RequestBody ControlPlaneDtos.CreateReleaseRequest request
  ) {
    return registryService.createRelease(request);
  }

  @PostMapping({"/api/v1/control/releases/{releaseId}/rollouts", "/api/v1/master/releases/{releaseId}/rollouts"})
  @ResponseStatus(HttpStatus.CREATED)
  public ControlPlaneDtos.CreateRolloutResponse createRollout(
      @PathVariable long releaseId,
      @Valid @RequestBody ControlPlaneDtos.CreateRolloutRequest request
  ) {
    return registryService.createRollout(releaseId, request);
  }

  @GetMapping({"/api/v1/control/releases/{releaseId}", "/api/v1/master/releases/{releaseId}"})
  public ControlPlaneDtos.ReleaseView getRelease(@PathVariable long releaseId) {
    return registryService.getRelease(releaseId);
  }
}
