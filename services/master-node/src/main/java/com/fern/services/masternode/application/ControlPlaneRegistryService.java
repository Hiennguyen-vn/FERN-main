package com.fern.services.masternode.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.fern.services.masternode.api.ControlPlaneDtos;
import com.fern.services.masternode.infrastructure.ControlPlanePersistenceRepository;
import com.fern.services.masternode.infrastructure.ControlPlanePersistenceRepository.AssignmentRecord;
import com.fern.services.masternode.infrastructure.ControlPlanePersistenceRepository.ServiceInstanceRecord;
import com.fern.services.masternode.infrastructure.ControlPlaneRedisStore;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class ControlPlaneRegistryService {

  private final Clock clock;
  private final Duration leaseTtl;
  private final Duration heartbeatInterval;
  private final SnowflakeIdGenerator idGenerator;
  private final boolean durable;
  private final ControlPlanePersistenceRepository repository;
  private final ControlPlaneRedisStore redisStore;

  private final ConcurrentMap<String, ConcurrentMap<Long, ServiceInstanceState>> instancesByService;
  private final ConcurrentMap<Long, ServiceInstanceState> instancesById;
  private final ConcurrentMap<String, ConfigState> configsByService;
  private final ConcurrentMap<String, CopyOnWriteArrayList<AssignmentState>> assignmentsByService;
  private final ConcurrentMap<Long, ReleaseState> releasesById;
  private final ConcurrentMap<Long, RolloutState> rolloutsById;

  @Autowired
 public ControlPlaneRegistryService(
      Clock clock,
      SnowflakeIdGenerator idGenerator,
      ControlPlanePersistenceRepository repository,
      ControlPlaneRedisStore redisStore,
      @Value("${fern.control.heartbeatLeaseSeconds:${dependencies.masterNode.heartbeatLeaseSeconds:30}}") long leaseTtlSeconds,
      @Value("${fern.control.heartbeatIntervalSeconds:${dependencies.masterNode.heartbeatIntervalSeconds:10}}") long heartbeatIntervalSeconds
  ) {
    this.clock = clock;
    this.leaseTtl = Duration.ofSeconds(leaseTtlSeconds);
    this.heartbeatInterval = Duration.ofSeconds(heartbeatIntervalSeconds);
    this.idGenerator = idGenerator;
    this.repository = repository;
    this.redisStore = redisStore;
    this.durable = true;
    this.instancesByService = new ConcurrentHashMap<>();
    this.instancesById = new ConcurrentHashMap<>();
    this.configsByService = new ConcurrentHashMap<>();
    this.assignmentsByService = new ConcurrentHashMap<>();
    this.releasesById = new ConcurrentHashMap<>();
    this.rolloutsById = new ConcurrentHashMap<>();
  }

  public ControlPlaneRegistryService(
      Clock clock,
      Duration leaseTtl,
      Duration heartbeatInterval,
      long workerId
  ) {
    this.clock = clock;
    this.leaseTtl = leaseTtl;
    this.heartbeatInterval = heartbeatInterval;
    this.idGenerator = new SnowflakeIdGenerator(workerId);
    this.repository = null;
    this.redisStore = null;
    this.durable = false;
    this.instancesByService = new ConcurrentHashMap<>();
    this.instancesById = new ConcurrentHashMap<>();
    this.configsByService = new ConcurrentHashMap<>();
    this.assignmentsByService = new ConcurrentHashMap<>();
    this.releasesById = new ConcurrentHashMap<>();
    this.rolloutsById = new ConcurrentHashMap<>();
  }

  public ControlPlaneDtos.ServiceRegistrationResponse register(
      ControlPlaneDtos.ServiceRegistrationRequest request
  ) {
    requireInternalServiceAccess();
    if (durable) {
      Instant now = clock.instant();
      long instanceId = request.instanceId() != null ? request.instanceId() : idGenerator.generateId();
      long configVersion = repository.ensureDefaultConfig(request.serviceName(), now);
      long effectiveInstanceId = repository.upsertInstance(instanceId, request, now, "UP");
      redisStore.touchInstance(request.serviceName(), effectiveInstanceId, Math.toIntExact(leaseTtl.toSeconds()));
      return new ControlPlaneDtos.ServiceRegistrationResponse(
          effectiveInstanceId,
          Math.toIntExact(leaseTtl.toSeconds()),
          configVersion,
          "/api/v1/control/services/" + effectiveInstanceId + "/heartbeat"
      );
    }

    Instant now = clock.instant();
    long instanceId = request.instanceId() != null ? request.instanceId() : idGenerator.generateId();
    ConfigState configState = configsByService.computeIfAbsent(
        request.serviceName(),
        serviceName -> ConfigState.defaultFor(serviceName, now)
    );

    ServiceInstanceState instance = new ServiceInstanceState(
        instanceId,
        request.serviceName(),
        request.version(),
        request.runtime(),
        request.host(),
        request.port(),
        "UP",
        now,
        now,
        safeList(request.regionCodes()),
        safeLongList(request.outletIds()),
        safeList(request.capabilities()),
        safeMap(request.metadata()),
        null
    );

    instancesByService.computeIfAbsent(request.serviceName(), ignored -> new ConcurrentHashMap<>())
        .put(instanceId, instance);
    instancesById.put(instanceId, instance);

    return new ControlPlaneDtos.ServiceRegistrationResponse(
        instanceId,
        Math.toIntExact(leaseTtl.toSeconds()),
        configState.configVersion(),
        "/api/v1/control/services/" + instanceId + "/heartbeat"
    );
  }

  public ControlPlaneDtos.MasterHeartbeatResponse upsertHeartbeat(
      ControlPlaneDtos.MasterHeartbeatRequest request
  ) {
    requireInternalServiceAccess();
    ControlPlaneDtos.ServiceRegistrationResponse response = register(
        new ControlPlaneDtos.ServiceRegistrationRequest(
            request.instanceId(),
            request.serviceName(),
            request.version(),
            request.runtime(),
            request.host(),
            request.port(),
            request.regionCodes(),
            request.outletIds(),
            request.capabilities(),
            request.metadata()
        )
    );
    return new ControlPlaneDtos.MasterHeartbeatResponse(
        response.instanceId(),
        defaultValue(request.status(), "UP"),
        response.leaseTtlSeconds()
    );
  }

  public ControlPlaneDtos.ServiceHeartbeatResponse heartbeat(
      long instanceId,
      ControlPlaneDtos.ServiceHeartbeatRequest request
  ) {
    requireInternalServiceAccess();
    if (durable) {
      ServiceInstanceRecord current = repository.findInstance(instanceId)
          .orElseThrow(() -> new NoSuchElementException("Instance not found: " + instanceId));
      repository.touchInstance(instanceId, request, clock.instant());
      redisStore.touchInstance(current.serviceName(), instanceId, Math.toIntExact(leaseTtl.toSeconds()));
      return new ControlPlaneDtos.ServiceHeartbeatResponse(true, Math.toIntExact(heartbeatInterval.toSeconds()));
    }

    ServiceInstanceState current = requireInstance(instanceId);
    ServiceInstanceState updated = current.withHeartbeat(
        clock.instant(),
        defaultValue(request.status(), "UP"),
        request.observedConfigVersion()
    );
    replace(updated);
    return new ControlPlaneDtos.ServiceHeartbeatResponse(true, Math.toIntExact(heartbeatInterval.toSeconds()));
  }

  public void deregister(long instanceId, ControlPlaneDtos.ServiceDeregisterRequest request) {
    requireInternalServiceAccess();
    if (durable) {
      ServiceInstanceRecord current = repository.findInstance(instanceId)
          .orElseThrow(() -> new NoSuchElementException("Instance not found: " + instanceId));
      repository.markDeregistered(instanceId, request.reason(), clock.instant());
      redisStore.removeInstance(current.serviceName(), instanceId);
      return;
    }

    ServiceInstanceState current = requireInstance(instanceId);
    ServiceInstanceState updated = current.withStatus("DEREGISTERED", clock.instant(), request.reason());
    replace(updated);
  }

  public List<ControlPlaneDtos.ServiceSummaryView> listServices() {
    requireOperatorAccess();
    if (durable) {
      Map<String, List<ServiceInstanceRecord>> grouped = repository.listAllInstances().stream()
          .collect(Collectors.groupingBy(ServiceInstanceRecord::serviceName, LinkedHashMap::new, Collectors.toList()));
      List<ControlPlaneDtos.ServiceSummaryView> views = new ArrayList<>();
      grouped.forEach((serviceName, records) -> {
        long active = records.stream().filter(this::isActive).count();
        long inactive = records.size() - active;
        Set<String> versions = records.stream()
            .map(ServiceInstanceRecord::version)
            .collect(Collectors.toCollection(LinkedHashSet::new));
        views.add(new ControlPlaneDtos.ServiceSummaryView(serviceName, active, inactive, List.copyOf(versions)));
      });
      views.sort(Comparator.comparing(ControlPlaneDtos.ServiceSummaryView::serviceName));
      return views;
    }

    return instancesByService.entrySet().stream()
        .map(entry -> {
          List<ServiceInstanceState> instances = new ArrayList<>(entry.getValue().values());
          long active = instances.stream().filter(this::isActive).count();
          long inactive = instances.size() - active;
          Set<String> versions = instances.stream()
              .map(ServiceInstanceState::version)
              .collect(Collectors.toCollection(LinkedHashSet::new));
          return new ControlPlaneDtos.ServiceSummaryView(entry.getKey(), active, inactive, List.copyOf(versions));
        })
        .sorted(Comparator.comparing(ControlPlaneDtos.ServiceSummaryView::serviceName))
        .toList();
  }

  public List<ControlPlaneDtos.ServiceInstanceView> listInstances(
      String serviceName,
      String regionCode,
      Long outletId,
      String capability
  ) {
    requireOperatorAccess();
    if (durable) {
      Map<Long, List<AssignmentRecord>> assignmentsByInstance = repository.listAssignments(serviceName).stream()
          .collect(Collectors.groupingBy(AssignmentRecord::instanceId, LinkedHashMap::new, Collectors.toList()));
      Set<Long> activeInstanceIds = redisStore.listActiveInstances(serviceName);

      return repository.listInstances(serviceName).stream()
          .map(record -> toView(record, assignmentsByInstance.getOrDefault(record.instanceId(), List.of()), activeInstanceIds))
          .filter(instance -> regionCode == null || instance.regionCodes().contains(regionCode))
          .filter(instance -> outletId == null || instance.outletIds().contains(outletId))
          .filter(instance -> capability == null || instance.capabilities().contains(capability))
          .sorted(Comparator.comparing(ControlPlaneDtos.ServiceInstanceView::instanceId))
          .toList();
    }

    return instancesByService.getOrDefault(serviceName, new ConcurrentHashMap<>()).values().stream()
        .filter(instance -> regionCode == null || instance.regionCodes().contains(regionCode))
        .filter(instance -> outletId == null || instance.outletIds().contains(outletId))
        .filter(instance -> capability == null || instance.capabilities().contains(capability))
        .sorted(Comparator.comparing(ServiceInstanceState::instanceId))
        .map(instance -> new ControlPlaneDtos.ServiceInstanceView(
            instance.instanceId(),
            instance.serviceName(),
            instance.version(),
            instance.runtime(),
            instance.host(),
            instance.port(),
            resolvedStatus(instance),
            instance.registeredAt(),
            instance.lastHeartbeatAt(),
            instance.regionCodes(),
            instance.outletIds(),
            instance.capabilities(),
            instance.metadata(),
            isActive(instance)
        ))
        .toList();
  }

  public List<ControlPlaneDtos.ServiceInstanceView> discovery(String serviceName) {
    requireInternalServiceAccess();
    return listInstances(serviceName, null, null, null).stream()
        .filter(ControlPlaneDtos.ServiceInstanceView::active)
        .toList();
  }

  public ControlPlaneDtos.EffectiveConfigResponse getConfig(String serviceName) {
    requireOperatorAccess();
    if (durable) {
      return repository.loadConfig(serviceName);
    }

    ConfigState configState = configsByService.computeIfAbsent(
        serviceName,
        name -> ConfigState.defaultFor(name, clock.instant())
    );
    return new ControlPlaneDtos.EffectiveConfigResponse(
        serviceName,
        configState.configVersion(),
        configState.etag(),
        configState.properties(),
        configState.featureFlags()
    );
  }

  public ControlPlaneDtos.ServiceAssignmentsResponse getAssignments(String serviceName) {
    requireOperatorAccess();
    if (durable) {
      return new ControlPlaneDtos.ServiceAssignmentsResponse(
          serviceName,
          repository.listAssignments(serviceName).stream()
              .map(assignment -> new ControlPlaneDtos.AssignmentView(
                  assignment.assignmentId(),
                  assignment.serviceName(),
                  assignment.regionCode(),
                  assignment.outletId(),
                  assignment.desiredInstances(),
                  assignment.routingWeight(),
                  assignment.active()
              ))
              .toList()
      );
    }

    List<AssignmentState> assignments = assignmentsByService.computeIfAbsent(
        serviceName,
        ignored -> new CopyOnWriteArrayList<>()
    );
    return new ControlPlaneDtos.ServiceAssignmentsResponse(
        serviceName,
        assignments.stream()
            .map(this::toAssignmentView)
            .sorted(Comparator.comparing(ControlPlaneDtos.AssignmentView::assignmentId))
            .toList()
    );
  }

  public ControlPlaneDtos.SystemHealthResponse systemHealth() {
    requireOperatorAccess();
    List<ControlPlaneDtos.ServiceSummaryView> services = listServices();
    long active = 0;
    long degraded = 0;
    long down = 0;

    if (durable) {
      for (ControlPlaneDtos.ServiceSummaryView summary : services) {
        active += summary.activeInstances();
        down += summary.inactiveInstances();
      }
      String overall = down > 0 ? "DEGRADED" : "UP";
      return new ControlPlaneDtos.SystemHealthResponse(
          overall,
          Math.toIntExact(leaseTtl.toSeconds()),
          Math.toIntExact(heartbeatInterval.toSeconds()),
          active,
          degraded,
          down,
          services
      );
    }

    for (ServiceInstanceState instance : instancesById.values()) {
      String status = resolvedStatus(instance);
      switch (status) {
        case "UP" -> active++;
        case "DEGRADED" -> degraded++;
        default -> down++;
      }
    }
    String overall = down > 0 ? "DEGRADED" : "UP";
    return new ControlPlaneDtos.SystemHealthResponse(
        overall,
        Math.toIntExact(leaseTtl.toSeconds()),
        Math.toIntExact(heartbeatInterval.toSeconds()),
        active,
        degraded,
        down,
        services
    );
  }

  public ControlPlaneDtos.ServiceHealthResponse serviceHealth(String serviceName) {
    requireOperatorAccess();
    List<ControlPlaneDtos.InstanceHealthView> instances = listInstances(serviceName, null, null, null).stream()
        .map(instance -> new ControlPlaneDtos.InstanceHealthView(
            instance.instanceId(),
            instance.status(),
            instance.lastHeartbeatAt(),
            instance.active(),
            instance.active() ? null : "Heartbeat expired"
        ))
        .toList();
    return new ControlPlaneDtos.ServiceHealthResponse(serviceName, instances);
  }

  public ControlPlaneDtos.CreateReleaseResponse createRelease(
      ControlPlaneDtos.CreateReleaseRequest request
  ) {
    requireOperatorAccess();
    if (durable) {
      return repository.createRelease(request, clock.instant());
    }

    long releaseId = idGenerator.generateId();
    ReleaseState release = new ReleaseState(
        releaseId,
        request.serviceName(),
        request.version(),
        request.imageRef(),
        "DRAFT",
        request.changeSummary(),
        request.createdBy(),
        clock.instant(),
        new CopyOnWriteArrayList<>()
    );
    releasesById.put(releaseId, release);
    return new ControlPlaneDtos.CreateReleaseResponse(releaseId, release.status());
  }

  public ControlPlaneDtos.CreateRolloutResponse createRollout(
      long releaseId,
      ControlPlaneDtos.CreateRolloutRequest request
  ) {
    requireOperatorAccess();
    if (durable) {
      return repository.createRollout(releaseId, request, clock.instant());
    }

    ReleaseState release = Optional.ofNullable(releasesById.get(releaseId))
        .orElseThrow(() -> new NoSuchElementException("Release not found: " + releaseId));
    long rolloutId = idGenerator.generateId();
    RolloutState rollout = new RolloutState(
        rolloutId,
        "PLANNED",
        "ROLLOUT",
        "PLANNED",
        List.copyOf(request.assignmentIds()),
        clock.instant(),
        null,
        request.approvalRef(),
        null
    );
    rolloutsById.put(rolloutId, rollout);
    release.rollouts().add(rollout);
    return new ControlPlaneDtos.CreateRolloutResponse(rolloutId, rollout.stage(), true);
  }

  public ControlPlaneDtos.ReleaseView getRelease(long releaseId) {
    requireOperatorAccess();
    if (durable) {
      return repository.loadRelease(releaseId);
    }

    ReleaseState release = Optional.ofNullable(releasesById.get(releaseId))
        .orElseThrow(() -> new NoSuchElementException("Release not found: " + releaseId));
    return new ControlPlaneDtos.ReleaseView(
        release.releaseId(),
        release.serviceName(),
        release.version(),
        release.imageRef(),
        release.status(),
        release.changeSummary(),
        release.createdBy(),
        release.createdAt(),
        release.rollouts().stream().map(this::toRolloutView).toList()
    );
  }

  public void pruneExpiredInstances() {
    if (!durable) {
      return;
    }
    Instant cutoff = clock.instant().minus(leaseTtl);
    List<Long> expiredIds = repository.findExpiredInstanceIds(cutoff);
    if (expiredIds.isEmpty()) {
      return;
    }
    Map<Long, String> servicesById = expiredIds.stream()
        .map(id -> repository.findInstance(id).orElse(null))
        .filter(record -> record != null)
        .collect(Collectors.toMap(ServiceInstanceRecord::instanceId, ServiceInstanceRecord::serviceName));
    repository.markDown(expiredIds, clock.instant());
    servicesById.forEach((instanceId, serviceName) -> redisStore.removeInstance(serviceName, instanceId));
  }

  private ServiceInstanceState requireInstance(long instanceId) {
    return Optional.ofNullable(instancesById.get(instanceId))
        .orElseThrow(() -> new NoSuchElementException("Instance not found: " + instanceId));
  }

  private void requireInternalServiceAccess() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return;
    }
    if (context.authenticated()) {
      throw ServiceException.forbidden("Internal control-plane access is required");
    }
    throw ServiceException.unauthorized("Authentication required");
  }

  private void requireOperatorAccess() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return;
    }
    if (context.authenticated()) {
      throw ServiceException.forbidden("Administrative control-plane access is required");
    }
    throw ServiceException.unauthorized("Authentication required");
  }

  private void replace(ServiceInstanceState updated) {
    instancesById.put(updated.instanceId(), updated);
    instancesByService.computeIfAbsent(updated.serviceName(), ignored -> new ConcurrentHashMap<>())
        .put(updated.instanceId(), updated);
  }

  private ControlPlaneDtos.AssignmentView toAssignmentView(AssignmentState assignment) {
    return new ControlPlaneDtos.AssignmentView(
        assignment.assignmentId(),
        assignment.serviceName(),
        assignment.regionCode(),
        assignment.outletId(),
        assignment.desiredInstances(),
        assignment.routingWeight(),
        assignment.active()
    );
  }

  private ControlPlaneDtos.RolloutView toRolloutView(RolloutState rollout) {
    return new ControlPlaneDtos.RolloutView(
        rollout.rolloutId(),
        rollout.stage(),
        rollout.desiredState(),
        rollout.actualState(),
        rollout.assignmentIds(),
        rollout.startedAt(),
        rollout.completedAt(),
        rollout.approvalRef(),
        rollout.errorSummary()
    );
  }

  private boolean isActive(ServiceInstanceRecord record) {
    if ("DEREGISTERED".equals(record.storedStatus()) || "DOWN".equals(record.storedStatus())) {
      return false;
    }
    return Duration.between(record.lastHeartbeatAt(), clock.instant()).compareTo(leaseTtl) <= 0;
  }

  private boolean isActive(ServiceInstanceState instance) {
    return "UP".equals(resolvedStatus(instance));
  }

  private String resolvedStatus(ServiceInstanceState instance) {
    if ("DEREGISTERED".equals(instance.status())) {
      return "DOWN";
    }
    Duration age = Duration.between(instance.lastHeartbeatAt(), clock.instant());
    if (age.compareTo(leaseTtl) > 0) {
      return "DOWN";
    }
    if (age.compareTo(heartbeatInterval.multipliedBy(2)) > 0) {
      return "DEGRADED";
    }
    return defaultValue(instance.status(), "UP");
  }

  private String resolvedStatus(ServiceInstanceRecord record, boolean redisAlive) {
    if (!redisAlive || "DEREGISTERED".equals(record.storedStatus()) || "DOWN".equals(record.storedStatus())) {
      return "DOWN";
    }
    Duration age = Duration.between(record.lastHeartbeatAt(), clock.instant());
    if (age.compareTo(heartbeatInterval.multipliedBy(2)) > 0) {
      return "DEGRADED";
    }
    return defaultValue(record.storedStatus(), "UP");
  }

  private ControlPlaneDtos.ServiceInstanceView toView(
      ServiceInstanceRecord record,
      List<AssignmentRecord> assignments,
      Set<Long> activeInstanceIds
  ) {
    Set<String> regionCodes = new LinkedHashSet<>();
    Set<Long> outletIds = new LinkedHashSet<>();
    Set<String> capabilities = new LinkedHashSet<>();
    for (AssignmentRecord assignment : assignments) {
      if (assignment.regionCode() != null && !assignment.regionCode().isBlank()) {
        regionCodes.add(assignment.regionCode());
      }
      if (assignment.outletId() != null) {
        outletIds.add(assignment.outletId());
      }
      if (assignment.capability() != null && !assignment.capability().isBlank()) {
        capabilities.add(assignment.capability());
      }
    }
    boolean active = activeInstanceIds.contains(record.instanceId()) && isActive(record);
    return new ControlPlaneDtos.ServiceInstanceView(
        record.instanceId(),
        record.serviceName(),
        record.version(),
        record.runtime(),
        record.host(),
        record.port(),
        resolvedStatus(record, activeInstanceIds.contains(record.instanceId())),
        record.firstRegisteredAt(),
        record.lastHeartbeatAt(),
        List.copyOf(regionCodes),
        List.copyOf(outletIds),
        List.copyOf(capabilities),
        record.metadata(),
        active
    );
  }

  private static String defaultValue(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  private static List<String> safeList(List<String> values) {
    return values == null ? List.of() : List.copyOf(values);
  }

  private static List<Long> safeLongList(List<Long> values) {
    return values == null ? List.of() : List.copyOf(values);
  }

  private static Map<String, Object> safeMap(Map<String, Object> values) {
    return values == null ? Map.of() : Map.copyOf(values);
  }

  private record ServiceInstanceState(
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
      String reason
  ) {
    private ServiceInstanceState withHeartbeat(
        Instant heartbeatAt,
        String nextStatus,
        Long observedConfigVersion
    ) {
      Map<String, Object> nextMetadata = new LinkedHashMap<>(metadata);
      if (observedConfigVersion != null) {
        nextMetadata.put("observedConfigVersion", observedConfigVersion);
      }
      return new ServiceInstanceState(
          instanceId,
          serviceName,
          version,
          runtime,
          host,
          port,
          nextStatus,
          registeredAt,
          heartbeatAt,
          regionCodes,
          outletIds,
          capabilities,
          Map.copyOf(nextMetadata),
          reason
      );
    }

    private ServiceInstanceState withStatus(String nextStatus, Instant changedAt, String nextReason) {
      return new ServiceInstanceState(
          instanceId,
          serviceName,
          version,
          runtime,
          host,
          port,
          nextStatus,
          registeredAt,
          changedAt,
          regionCodes,
          outletIds,
          capabilities,
          metadata,
          nextReason
      );
    }
  }

  private record ConfigState(
      long configVersion,
      String etag,
      Map<String, Object> properties,
      Map<String, Boolean> featureFlags
  ) {
    private static ConfigState defaultFor(String serviceName, Instant now) {
      return new ConfigState(1L, serviceName + "-" + now.toEpochMilli(), Map.of(), Map.of());
    }
  }

  private record AssignmentState(
      long assignmentId,
      String serviceName,
      String regionCode,
      Long outletId,
      int desiredInstances,
      int routingWeight,
      boolean active
  ) {
  }

  private record ReleaseState(
      long releaseId,
      String serviceName,
      String version,
      String imageRef,
      String status,
      String changeSummary,
      String createdBy,
      Instant createdAt,
      CopyOnWriteArrayList<RolloutState> rollouts
  ) {
  }

  private record RolloutState(
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
}
