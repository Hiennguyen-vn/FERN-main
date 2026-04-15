package com.fern.services.auth.spring.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.AuthSessionRepository;
import com.dorabets.common.spring.auth.AuthSessionService;
import com.dorabets.common.spring.auth.BusinessScopeAssignment;
import com.dorabets.common.spring.auth.BusinessUserProfile;
import com.dorabets.common.spring.auth.CanonicalRole;
import com.dorabets.common.spring.auth.JwtClaims;
import com.dorabets.common.spring.auth.JwtTokenService;
import com.dorabets.common.spring.auth.OrgScopeRepository;
import com.dorabets.common.spring.auth.PermissionMatrix;
import com.dorabets.common.spring.auth.PermissionMatrixService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.auth.RoleAliasResolver;
import com.dorabets.common.spring.auth.ScopeType;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.events.auth.RoleUpdatedEvent;
import com.fern.events.auth.UserCreatedEvent;
import com.fern.services.auth.spring.api.AuthDtos;
import com.fern.services.auth.spring.infrastructure.AuthUserRepository;
import com.fern.services.auth.spring.infrastructure.AuthUserRepository.AuthUserRecord;
import com.fern.services.auth.spring.infrastructure.AuthUserRepository.CreateUserCommand;
import com.fern.services.auth.spring.infrastructure.AuthUserRepository.OutletAccessGrant;
import com.fern.services.auth.spring.infrastructure.AuthUserRepository.RolePermissionUpdateResult;
import com.natsu.common.utils.security.PasswordUtil;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

  private final AuthUserRepository authUserRepository;
  private final PermissionMatrixService permissionMatrixService;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final OrgScopeRepository orgScopeRepository;
  private final RoleAliasResolver roleAliasResolver;
  private final JwtTokenService jwtTokenService;
  private final AuthSessionService authSessionService;
  private final TypedKafkaEventPublisher kafkaEventPublisher;
  private final Clock clock;
  private final long accessTokenTtlSeconds;

  public AuthService(
      AuthUserRepository authUserRepository,
      PermissionMatrixService permissionMatrixService,
      AuthorizationPolicyService authorizationPolicyService,
      OrgScopeRepository orgScopeRepository,
      RoleAliasResolver roleAliasResolver,
      JwtTokenService jwtTokenService,
      AuthSessionService authSessionService,
      TypedKafkaEventPublisher kafkaEventPublisher,
      Clock clock,
      @Value("${security.jwt.access-token-ttl-seconds:3600}") long accessTokenTtlSeconds
  ) {
    this.authUserRepository = authUserRepository;
    this.permissionMatrixService = permissionMatrixService;
    this.authorizationPolicyService = authorizationPolicyService;
    this.orgScopeRepository = orgScopeRepository;
    this.roleAliasResolver = roleAliasResolver;
    this.jwtTokenService = jwtTokenService;
    this.authSessionService = authSessionService;
    this.kafkaEventPublisher = kafkaEventPublisher;
    this.clock = clock;
    this.accessTokenTtlSeconds = accessTokenTtlSeconds;
  }

  public AuthDtos.LoginResponse login(AuthDtos.LoginRequest request, HttpServletRequest httpRequest) {
    AuthUserRecord user = authUserRepository.findByUsername(request.username())
        .orElseThrow(() -> ServiceException.unauthorized("Invalid username or password"));
    verifyUserCanLogin(user, request.password());
    PermissionMatrix matrix = permissionMatrixService.load(user.id());
    AuthSessionRepository.AuthSessionRecord session = authSessionService.openSession(
        user.id(),
        accessTokenTtlSeconds,
        resolveUserAgent(httpRequest),
        resolveClientIp(httpRequest)
    );
    Set<Long> allOutletIds = new LinkedHashSet<>();
    allOutletIds.addAll(matrix.rolesByOutlet().keySet());
    allOutletIds.addAll(matrix.permissionsByOutlet().keySet());
    String token = jwtTokenService.issueAccessToken(
        user.id(),
        user.username(),
        session.sessionId(),
        flatten(matrix.rolesByOutlet()),
        flatten(matrix.permissionsByOutlet()),
        allOutletIds,
        accessTokenTtlSeconds
    );
    return toLoginResponse(token, user, matrix, session);
  }

  public AuthDtos.MeResponse me() {
    RequestUserContext context = RequestUserContextHolder.get();
    long userId = context.requireUserId();
    AuthSessionRepository.AuthSessionRecord session = authSessionService.getRequiredSession(context.sessionId(), userId);
    authSessionService.requireActiveSession(context.sessionId(), userId);
    AuthUserRecord user = authUserRepository.findById(userId)
        .orElseThrow(() -> ServiceException.notFound("User not found: " + userId));
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    return new AuthDtos.MeResponse(
        toUserSummary(user),
        matrix.rolesByOutlet(),
        matrix.permissionsByOutlet(),
        toBusinessScopeViews(authorizationPolicyService.resolveUserProfile(userId, matrix)),
        session.sessionId(),
        session.issuedAt(),
        session.expiresAt()
    );
  }

  public AuthDtos.LoginResponse refresh(HttpServletRequest httpRequest) {
    RequestUserContext context = RequestUserContextHolder.get();
    long userId = context.requireUserId();
    AuthSessionRepository.AuthSessionRecord refreshedSession = authSessionService.refreshSession(
        context.sessionId(),
        userId,
        accessTokenTtlSeconds,
        resolveUserAgent(httpRequest),
        resolveClientIp(httpRequest)
    );
    AuthUserRecord user = authUserRepository.findById(userId)
        .orElseThrow(() -> ServiceException.notFound("User not found: " + userId));
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    Set<Long> allOutletIds = new LinkedHashSet<>();
    allOutletIds.addAll(matrix.rolesByOutlet().keySet());
    allOutletIds.addAll(matrix.permissionsByOutlet().keySet());
    String token = jwtTokenService.issueAccessToken(
        user.id(),
        user.username(),
        refreshedSession.sessionId(),
        flatten(matrix.rolesByOutlet()),
        flatten(matrix.permissionsByOutlet()),
        allOutletIds,
        accessTokenTtlSeconds
    );
    return toLoginResponse(token, user, matrix, refreshedSession);
  }

  public AuthDtos.LogoutResponse logout() {
    RequestUserContext context = RequestUserContextHolder.get();
    long userId = context.requireUserId();
    AuthSessionRepository.AuthSessionRecord session = authSessionService.logoutSession(context.sessionId(), userId);
    return new AuthDtos.LogoutResponse(session.sessionId(), session.revokedAt());
  }

  public List<AuthDtos.SessionView> listSessions() {
    RequestUserContext context = RequestUserContextHolder.get();
    long userId = context.requireUserId();
    Instant now = clock.instant();
    return authSessionService.listSessions(userId).stream()
        .map(session -> toSessionView(session, context.sessionId(), now))
        .toList();
  }

  public AuthDtos.SessionView revokeSession(String sessionId) {
    RequestUserContext context = RequestUserContextHolder.get();
    long userId = context.requireUserId();
    AuthSessionRepository.AuthSessionRecord targetSession = authSessionService.findSession(sessionId)
        .filter(session -> session.userId() == userId)
        .orElseThrow(() -> ServiceException.notFound("Session not found: " + sessionId));
    AuthSessionRepository.AuthSessionRecord revoked = authSessionService.revokeSession(
        targetSession.sessionId(),
        userId,
        userId,
        "user_revoke"
    );
    return toSessionView(revoked, context.sessionId(), clock.instant());
  }

  public AuthDtos.UserSummary createUser(AuthDtos.CreateUserRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    long existingUsers = authUserRepository.countActiveUsers();
    List<OutletAccessGrant> accessGrants = resolveAccessGrants(request);
    if (existingUsers > 0) {
      enforceUserCreationPermission(context, accessGrants);
    }

    String passwordHash;
    try {
      passwordHash = PasswordUtil.hash(request.password());
    } catch (Exception e) {
      throw new IllegalStateException("Unable to hash password", e);
    }

    AuthUserRecord created = authUserRepository.createUser(new CreateUserCommand(
        request.username().trim(),
        passwordHash,
        request.fullName().trim(),
        trimToNull(request.employeeCode()),
        trimToNull(request.email()),
        accessGrants
    ));

    PermissionMatrix matrix = permissionMatrixService.load(created.id());
    kafkaEventPublisher.publish(
        "fern.auth.user-created",
        Long.toString(created.id()),
        "auth.user.created",
        new UserCreatedEvent(
            created.id(),
            created.username(),
            created.fullName(),
            created.employeeCode(),
            created.status(),
            matrix.rolesByOutlet(),
            matrix.permissionsByOutlet(),
            clock.instant(),
            context.userId()
        )
    );
    return toUserSummary(created);
  }

  public PagedResult<AuthDtos.UserListItem> listUsers(
      String username,
      String q,
      String status,
      Long outletId,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    Set<Long> readableOutletIds = resolveReadableOutletIds(outletId);
    String normalizedQuery = QueryConventions.normalizeQuery(q);
    String effectiveUsername = normalizedQuery == null ? username : normalizedQuery;
    return authUserRepository.listUsers(
        effectiveUsername,
        status,
        readableOutletIds,
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public PagedResult<AuthDtos.UserScopeView> listScopes(
      Long userId,
      String username,
      String q,
      Long outletId,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    Set<Long> readableOutletIds = resolveReadableOutletIds(outletId);
    String normalizedQuery = QueryConventions.normalizeQuery(q);
    String effectiveUsername = normalizedQuery == null ? username : normalizedQuery;
    return authUserRepository.listScopes(
        userId,
        effectiveUsername,
        readableOutletIds,
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public PagedResult<AuthDtos.UserPermissionOverrideView> listOverrides(
      Long userId,
      String username,
      String q,
      Long outletId,
      String permissionCode,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    Set<Long> readableOutletIds = resolveReadableOutletIds(outletId);
    String normalizedQuery = QueryConventions.normalizeQuery(q);
    String effectiveUsername = normalizedQuery == null ? username : normalizedQuery;
    return authUserRepository.listOverrides(
        userId,
        effectiveUsername,
        permissionCode,
        readableOutletIds,
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public PagedResult<AuthDtos.PermissionCatalogItem> listPermissionCatalog(
      String module,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    requireIamCatalogRead();
    return authUserRepository.listPermissionCatalog(
        trimToNull(module),
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public PagedResult<AuthDtos.RoleCatalogItem> listRoleCatalog(
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    requireIamCatalogRead();
    return authUserRepository.listRoleCatalog(
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public List<AuthDtos.BusinessRoleCatalogItem> listBusinessRoles() {
    requireIamCatalogRead();
    return authorizationPolicyService.businessRoles().stream()
        .map(role -> new AuthDtos.BusinessRoleCatalogItem(
            role.code(),
            role.displayName(),
            businessRoleDescription(role),
            role.defaultScopeType().code(),
            roleAliasResolver.aliasesFor(role)
        ))
        .toList();
  }

  public AuthDtos.RolePermissionsResponse updateRolePermissions(
      String roleCode,
      AuthDtos.UpdateRolePermissionsRequest request
  ) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireGlobalRoleAdmin(context);
    RolePermissionUpdateResult result = authUserRepository.replaceRolePermissions(
        roleCode,
        normalizeValues(request.permissionCodes())
    );
    authUserRepository.findUserIdsByRoleCode(roleCode).forEach(permissionMatrixService::evict);
    kafkaEventPublisher.publish(
        "fern.auth.role-updated",
        result.roleCode(),
        "auth.role.updated",
        new RoleUpdatedEvent(
            result.roleCode(),
            result.permissionCodes(),
            result.updatedAt(),
            context.userId()
        )
    );
    return new AuthDtos.RolePermissionsResponse(
        result.roleCode(),
        result.permissionCodes(),
        result.updatedAt()
    );
  }

  private void verifyUserCanLogin(AuthUserRecord user, String password) {
    if (!"active".equalsIgnoreCase(user.status())) {
      throw ServiceException.forbidden("User is not active");
    }
    try {
      if (!PasswordUtil.verifyPassword(password, user.passwordHash())) {
        throw ServiceException.unauthorized("Invalid username or password");
      }
    } catch (ServiceException e) {
      throw e;
    } catch (Exception e) {
      throw ServiceException.unauthorized("Invalid username or password");
    }
  }

  private void enforceUserCreationPermission(
      RequestUserContext context,
      List<OutletAccessGrant> accessGrants
  ) {
    if (context.internalService()) {
      return;
    }
    long actorUserId = context.requireUserId();
    BusinessUserProfile actorProfile = authorizationPolicyService.resolveUserProfile(actorUserId);
    if (actorProfile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return;
    }
    if (accessGrants.isEmpty()) {
      throw ServiceException.forbidden("User creation requires admin access or outlet assignments");
    }

    Set<Long> requestedOutletIds = accessGrants.stream()
        .map(OutletAccessGrant::outletId)
        .collect(Collectors.toCollection(LinkedHashSet::new));
    if (!actorProfile.outletsForRole(CanonicalRole.ADMIN).isEmpty()) {
      authorizationPolicyService.requireGovernedOutlets(context, requestedOutletIds);
      for (OutletAccessGrant accessGrant : accessGrants) {
        for (String roleCode : accessGrant.roles()) {
          if (!authorizationPolicyService.canAssignRole(context, roleCode, Set.of(accessGrant.outletId()))) {
            throw ServiceException.forbidden("Role assignment is outside admin scope: " + roleCode);
          }
        }
      }
      return;
    }

    for (OutletAccessGrant accessGrant : accessGrants) {
      if (!permissionMatrixService.hasPermission(actorUserId, accessGrant.outletId(), "auth.user.write")) {
        throw ServiceException.forbidden(
            "Missing auth.user.write for outlet " + accessGrant.outletId()
        );
      }
      if (!accessGrant.roles().isEmpty()
          && !permissionMatrixService.hasPermission(actorUserId, accessGrant.outletId(), "auth.role.write")) {
        throw ServiceException.forbidden("Missing auth.role.write for outlet " + accessGrant.outletId());
      }
      for (String roleCode : accessGrant.roles()) {
        CanonicalRole canonicalRole = roleAliasResolver.toCanonicalRole(roleCode)
            .orElseThrow(() -> ServiceException.forbidden("Unsupported business role assignment: " + roleCode));
        if (canonicalRole == CanonicalRole.ADMIN || canonicalRole == CanonicalRole.SUPERADMIN) {
          throw ServiceException.forbidden("Direct IAM writers cannot assign administrative roles");
        }
      }
    }
  }

  private void requireGlobalRoleAdmin(RequestUserContext context) {
    if (context.internalService()) {
      return;
    }
    context.requireUserId();
    if (authorizationPolicyService.resolveUserProfile(context.userId()).hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return;
    }
    throw ServiceException.forbidden("Superadmin role management is required");
  }

  private void requireIamCatalogRead() {
    resolveReadableOutletIds(null);
  }

  private Set<Long> resolveReadableOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> readableOutletIds = authorizationPolicyService.resolveGovernedOutletIds(context);
    if (readableOutletIds == null) {
      return requestedOutletId == null ? null : Set.of(requestedOutletId);
    }
    if (readableOutletIds.isEmpty()) {
      throw ServiceException.forbidden("IAM read access is required");
    }
    if (requestedOutletId != null) {
      if (!readableOutletIds.contains(requestedOutletId)) {
        throw ServiceException.forbidden("IAM read access denied for outlet " + requestedOutletId);
      }
      return Set.of(requestedOutletId);
    }
    return readableOutletIds;
  }

  private int sanitizeLimit(int limit) {
    return QueryConventions.sanitizeLimit(limit, 100, 500);
  }

  private int sanitizeOffset(int offset) {
    return QueryConventions.sanitizeOffset(offset);
  }

  private static Set<String> flatten(Map<Long, Set<String>> valuesByOutlet) {
    return valuesByOutlet.values().stream()
        .flatMap(Set::stream)
        .collect(Collectors.toCollection(LinkedHashSet::new));
  }

  private static Set<String> normalizeValues(Set<String> values) {
    if (values == null || values.isEmpty()) {
      return Set.of();
    }
    return values.stream()
        .filter(value -> value != null && !value.isBlank())
        .map(String::trim)
        .collect(Collectors.toCollection(LinkedHashSet::new));
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private static AuthDtos.UserSummary toUserSummary(AuthUserRecord user) {
    return new AuthDtos.UserSummary(
        user.id(),
        user.username(),
        user.fullName(),
        user.employeeCode(),
        user.email(),
        user.status()
    );
  }

  private AuthDtos.LoginResponse toLoginResponse(
      String token,
      AuthUserRecord user,
      PermissionMatrix matrix,
      AuthSessionRepository.AuthSessionRecord session
  ) {
    BusinessUserProfile profile = authorizationPolicyService.resolveUserProfile(user.id(), matrix);
    return new AuthDtos.LoginResponse(
        token,
        accessTokenTtlSeconds,
        toUserSummary(user),
        matrix.rolesByOutlet(),
        matrix.permissionsByOutlet(),
        toBusinessScopeViews(profile),
        session.sessionId(),
        session.issuedAt(),
        session.expiresAt()
    );
  }

  private List<OutletAccessGrant> resolveAccessGrants(AuthDtos.CreateUserRequest request) {
    Map<Long, MutableGrant> grantsByOutlet = new LinkedHashMap<>();
    if (request.outletAccess() != null) {
      request.outletAccess().forEach(assignment -> mergeGrant(
          grantsByOutlet,
          assignment.outletId(),
          normalizeRoleCodes(assignment.roles(), false),
          normalizeValues(assignment.permissions())
      ));
    }
    if (request.scopeAssignments() != null) {
      request.scopeAssignments().forEach(assignment -> {
        ScopeType scopeType = ScopeType.fromCode(assignment.scopeType());
        Set<String> roleCodes = normalizeRoleCodes(assignment.roles(), true);
        Set<String> permissionCodes = normalizeValues(assignment.permissions());
        List<Long> outletIds = resolveScopeOutletIds(scopeType, assignment.scopeId(), roleCodes);
        outletIds.forEach(outletId -> mergeGrant(grantsByOutlet, outletId, roleCodes, permissionCodes));
      });
    }
    return grantsByOutlet.values().stream()
        .map(grant -> new OutletAccessGrant(
            grant.outletId(),
            Set.copyOf(grant.roles()),
            Set.copyOf(grant.permissions())
        ))
        .toList();
  }

  private List<Long> resolveScopeOutletIds(ScopeType scopeType, String scopeId, Set<String> roleCodes) {
    return switch (scopeType) {
      case OUTLET -> List.of(parseOutletId(scopeId));
      case REGION -> {
        OrgScopeRepository.RegionScope regionScope = orgScopeRepository.findRegionScope(scopeId)
            .orElseThrow(() -> ServiceException.notFound("Region scope not found: " + scopeId));
        if (regionScope.outletIds().isEmpty()) {
          throw ServiceException.badRequest("Region scope has no active outlets: " + scopeId);
        }
        yield regionScope.outletIds().stream().sorted().toList();
      }
      case GLOBAL -> {
        if (roleCodes.stream().map(roleAliasResolver::toCanonicalRole).flatMap(Optional::stream)
            .anyMatch(role -> role != CanonicalRole.SUPERADMIN)) {
          throw ServiceException.badRequest("Global scope is reserved for superadmin");
        }
        Set<Long> outletIds = orgScopeRepository.findAllActiveOutletIds();
        if (outletIds.isEmpty()) {
          throw ServiceException.badRequest("Global scope has no active outlets");
        }
        yield outletIds.stream().sorted().toList();
      }
    };
  }

  private long parseOutletId(String scopeId) {
    try {
      return Long.parseLong(Objects.requireNonNull(scopeId).trim());
    } catch (Exception e) {
      throw ServiceException.badRequest("Invalid outlet scope id: " + scopeId);
    }
  }

  private Set<String> normalizeRoleCodes(Set<String> values, boolean strictBusinessRole) {
    if (values == null || values.isEmpty()) {
      return Set.of();
    }
    LinkedHashSet<String> normalized = new LinkedHashSet<>();
    for (String value : values) {
      if (value == null || value.isBlank()) {
        continue;
      }
      Optional<CanonicalRole> canonicalRole = roleAliasResolver.toCanonicalRole(value);
      if (strictBusinessRole && canonicalRole.isEmpty()) {
        throw ServiceException.badRequest("Unsupported business role: " + value);
      }
      normalized.add(roleAliasResolver.toStoredRoleCode(value));
    }
    return Set.copyOf(normalized);
  }

  private void mergeGrant(
      Map<Long, MutableGrant> grantsByOutlet,
      long outletId,
      Set<String> roles,
      Set<String> permissions
  ) {
    MutableGrant grant = grantsByOutlet.computeIfAbsent(outletId, MutableGrant::new);
    grant.roles().addAll(roles);
    grant.permissions().addAll(permissions);
  }

  private List<AuthDtos.BusinessScopeView> toBusinessScopeViews(BusinessUserProfile profile) {
    Map<String, MutableBusinessScopeView> grouped = new LinkedHashMap<>();
    for (BusinessScopeAssignment assignment : profile.assignments()) {
      String scopeId = assignment.scopeType() == ScopeType.GLOBAL
          ? "global"
          : assignment.scopeId() == null ? null : Long.toString(assignment.scopeId());
      String key = assignment.scopeType().code() + ":" + scopeId;
      MutableBusinessScopeView view = grouped.computeIfAbsent(
          key,
          ignored -> new MutableBusinessScopeView(assignment.scopeType().code(), scopeId, assignment.scopeCode())
      );
      view.roles().add(assignment.role().code());
      view.outletIds().addAll(assignment.outletIds());
    }
    return grouped.values().stream()
        .map(view -> new AuthDtos.BusinessScopeView(
            view.scopeType(),
            view.scopeId(),
            view.scopeCode(),
            Set.copyOf(view.roles()),
            Set.copyOf(view.outletIds())
        ))
        .toList();
  }

  private String businessRoleDescription(CanonicalRole role) {
    return switch (role) {
      case SUPERADMIN -> "Full chain-wide authority and emergency override";
      case ADMIN -> "Scoped IAM governance for region or outlet";
      case REGION_MANAGER -> "Regional operational oversight";
      case OUTLET_MANAGER -> "Outlet owner for store operations and approvals";
      case STAFF -> "Frontline cashier and POS operator";
      case PRODUCT_MANAGER -> "Regional menu, catalog, and pricing owner";
      case PROCUREMENT -> "Store procurement operator without final approval";
      case FINANCE -> "Regional finance and payroll approver";
      case KITCHEN_STAFF -> "Outlet kitchen and fulfillment operator";
      case HR -> "Regional HR, scheduling, contracts, and payroll preparation";
    };
  }

  private record MutableGrant(
      long outletId,
      LinkedHashSet<String> roles,
      LinkedHashSet<String> permissions
  ) {

    private MutableGrant(long outletId) {
      this(outletId, new LinkedHashSet<>(), new LinkedHashSet<>());
    }
  }

  private record MutableBusinessScopeView(
      String scopeType,
      String scopeId,
      String scopeCode,
      LinkedHashSet<String> roles,
      LinkedHashSet<Long> outletIds
  ) {

    private MutableBusinessScopeView(String scopeType, String scopeId, String scopeCode) {
      this(scopeType, scopeId, scopeCode, new LinkedHashSet<>(), new LinkedHashSet<>());
    }
  }

  private static AuthDtos.SessionView toSessionView(
      AuthSessionRepository.AuthSessionRecord session,
      String currentSessionId,
      Instant now
  ) {
    String state = session.revokedAt() != null
        ? "revoked"
        : session.expiresAt().isBefore(now)
            ? "expired"
            : "active";
    return new AuthDtos.SessionView(
        session.sessionId(),
        state,
        session.issuedAt(),
        session.expiresAt(),
        session.refreshedAt(),
        session.revokedAt(),
        session.revokedByUserId(),
        session.revokeReason(),
        session.userAgent(),
        session.clientIp(),
        session.sessionId().equals(currentSessionId)
    );
  }

  private static String resolveUserAgent(HttpServletRequest request) {
    if (request == null) {
      return null;
    }
    return trimToNull(request.getHeader("User-Agent"));
  }

  private static String resolveClientIp(HttpServletRequest request) {
    if (request == null) {
      return null;
    }
    String forwardedFor = trimToNull(request.getHeader("X-Forwarded-For"));
    if (forwardedFor != null) {
      int delimiterIndex = forwardedFor.indexOf(',');
      return delimiterIndex >= 0 ? forwardedFor.substring(0, delimiterIndex).trim() : forwardedFor;
    }
    return trimToNull(request.getRemoteAddr());
  }
}
