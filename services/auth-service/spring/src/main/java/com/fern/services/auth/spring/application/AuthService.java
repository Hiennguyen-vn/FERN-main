package com.fern.services.auth.spring.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthSessionRepository;
import com.dorabets.common.spring.auth.AuthSessionService;
import com.dorabets.common.spring.auth.JwtClaims;
import com.dorabets.common.spring.auth.JwtTokenService;
import com.dorabets.common.spring.auth.PermissionMatrix;
import com.dorabets.common.spring.auth.PermissionMatrixService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
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
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

  private final AuthUserRepository authUserRepository;
  private final PermissionMatrixService permissionMatrixService;
  private final JwtTokenService jwtTokenService;
  private final AuthSessionService authSessionService;
  private final TypedKafkaEventPublisher kafkaEventPublisher;
  private final Clock clock;
  private final long accessTokenTtlSeconds;

  public AuthService(
      AuthUserRepository authUserRepository,
      PermissionMatrixService permissionMatrixService,
      JwtTokenService jwtTokenService,
      AuthSessionService authSessionService,
      TypedKafkaEventPublisher kafkaEventPublisher,
      Clock clock,
      @Value("${security.jwt.access-token-ttl-seconds:3600}") long accessTokenTtlSeconds
  ) {
    this.authUserRepository = authUserRepository;
    this.permissionMatrixService = permissionMatrixService;
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
    String token = jwtTokenService.issueAccessToken(
        user.id(),
        user.username(),
        session.sessionId(),
        flatten(matrix.rolesByOutlet()),
        flatten(matrix.permissionsByOutlet()),
        matrix.permissionsByOutlet().keySet(),
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
    String token = jwtTokenService.issueAccessToken(
        user.id(),
        user.username(),
        refreshedSession.sessionId(),
        flatten(matrix.rolesByOutlet()),
        flatten(matrix.permissionsByOutlet()),
        matrix.permissionsByOutlet().keySet(),
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
    if (existingUsers > 0) {
      enforceUserCreationPermission(context, request);
    }

    String passwordHash;
    try {
      passwordHash = PasswordUtil.hash(request.password());
    } catch (Exception e) {
      throw new IllegalStateException("Unable to hash password", e);
    }

    List<OutletAccessGrant> accessGrants = request.outletAccess() == null
        ? List.of()
        : request.outletAccess().stream()
            .map(assignment -> new OutletAccessGrant(
                assignment.outletId(),
                normalizeValues(assignment.roles()),
                normalizeValues(assignment.permissions())
            ))
            .toList();

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

  public AuthDtos.RolePermissionsResponse updateRolePermissions(
      String roleCode,
      AuthDtos.UpdateRolePermissionsRequest request
  ) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireRoleAdmin(context);
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
      AuthDtos.CreateUserRequest request
  ) {
    long actorUserId = context.requireUserId();
    if (isAdminContext(context)) {
      return;
    }
    if (request.outletAccess() == null || request.outletAccess().isEmpty()) {
      throw ServiceException.forbidden("User creation requires admin access or outlet assignments");
    }
    for (AuthDtos.OutletAccessAssignment assignment : request.outletAccess()) {
      if (!permissionMatrixService.hasPermission(actorUserId, assignment.outletId(), "auth.user.write")) {
        throw ServiceException.forbidden(
            "Missing auth.user.write for outlet " + assignment.outletId()
        );
      }
    }
  }

  private void requireRoleAdmin(RequestUserContext context) {
    context.requireUserId();
    if (isAdminContext(context)) {
      return;
    }
    throw ServiceException.forbidden("Administrative role management is required");
  }

  private boolean isAdminContext(RequestUserContext context) {
    return context.internalService()
        || context.hasRole("admin")
        || context.hasRole("superadmin")
        || context.hasPermission("auth.role.write");
  }

  private void requireIamCatalogRead() {
    resolveReadableOutletIds(null);
  }

  private Set<Long> resolveReadableOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return requestedOutletId == null ? null : Set.of(requestedOutletId);
    }

    context.requireUserId();
    if (!context.hasPermission("auth.user.write") && !context.hasPermission("auth.role.write")) {
      throw ServiceException.forbidden("IAM read access is required");
    }
    if (context.outletIds().isEmpty()) {
      throw ServiceException.forbidden("IAM read access requires outlet scope");
    }
    if (requestedOutletId != null) {
      if (!context.outletIds().contains(requestedOutletId)) {
        throw ServiceException.forbidden("IAM read access denied for outlet " + requestedOutletId);
      }
      return Set.of(requestedOutletId);
    }
    return context.outletIds();
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
    return new AuthDtos.LoginResponse(
        token,
        accessTokenTtlSeconds,
        toUserSummary(user),
        matrix.rolesByOutlet(),
        matrix.permissionsByOutlet(),
        session.sessionId(),
        session.issuedAt(),
        session.expiresAt()
    );
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
