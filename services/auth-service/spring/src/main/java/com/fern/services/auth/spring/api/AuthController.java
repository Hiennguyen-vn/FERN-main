package com.fern.services.auth.spring.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.auth.spring.application.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

  private final AuthService authService;
  private final String authCookieName;
  private final String authCookieSameSite;
  private final boolean authCookieSecure;
  private final String authCookieDomain;

  public AuthController(
      AuthService authService,
      @Value("${AUTH_COOKIE_NAME:dorabets_session}") String authCookieName,
      @Value("${AUTH_COOKIE_SAME_SITE:Lax}") String authCookieSameSite,
      @Value("${AUTH_COOKIE_SECURE:false}") boolean authCookieSecure,
      @Value("${AUTH_COOKIE_DOMAIN:}") String authCookieDomain
  ) {
    this.authService = authService;
    this.authCookieName = authCookieName;
    this.authCookieSameSite = authCookieSameSite;
    this.authCookieSecure = authCookieSecure;
    this.authCookieDomain = authCookieDomain;
  }

  @PostMapping("/login")
  public AuthDtos.LoginResponse login(
      @Valid @RequestBody AuthDtos.LoginRequest request,
      HttpServletRequest httpRequest,
      HttpServletResponse httpResponse
  ) {
    AuthDtos.LoginResponse response = authService.login(request, httpRequest);
    writeSessionCookie(httpResponse, response.accessToken(), response.expiresAt());
    return response;
  }

  @GetMapping("/me")
  public AuthDtos.MeResponse me() {
    return authService.me();
  }

  @PostMapping("/refresh")
  public AuthDtos.LoginResponse refresh(HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
    AuthDtos.LoginResponse response = authService.refresh(httpRequest);
    writeSessionCookie(httpResponse, response.accessToken(), response.expiresAt());
    return response;
  }

  @PostMapping("/logout")
  public AuthDtos.LogoutResponse logout(HttpServletResponse httpResponse) {
    AuthDtos.LogoutResponse response = authService.logout();
    clearSessionCookie(httpResponse);
    return response;
  }

  @GetMapping("/sessions")
  public List<AuthDtos.SessionView> listSessions() {
    return authService.listSessions();
  }

  @PostMapping("/sessions/{sessionId}/revoke")
  public AuthDtos.SessionView revokeSession(@PathVariable String sessionId) {
    return authService.revokeSession(sessionId);
  }

  @PostMapping("/users")
  @ResponseStatus(HttpStatus.CREATED)
  public AuthDtos.UserSummary createUser(@Valid @RequestBody AuthDtos.CreateUserRequest request) {
    return authService.createUser(request);
  }

  @GetMapping("/users")
  public PagedResult<AuthDtos.UserListItem> listUsers(
      @RequestParam(required = false) String username,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return authService.listUsers(username, q, status, outletId, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/scopes")
  public PagedResult<AuthDtos.UserScopeView> listScopes(
      @RequestParam(required = false) Long userId,
      @RequestParam(required = false) String username,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return authService.listScopes(userId, username, q, outletId, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/overrides")
  public PagedResult<AuthDtos.UserPermissionOverrideView> listOverrides(
      @RequestParam(required = false) Long userId,
      @RequestParam(required = false) String username,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String permissionCode,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return authService.listOverrides(
        userId,
        username,
        q,
        outletId,
        permissionCode,
        sortBy,
        sortDir,
        limit,
        offset);
  }

  @GetMapping("/permissions")
  public PagedResult<AuthDtos.PermissionCatalogItem> listPermissionCatalog(
      @RequestParam(required = false) String module,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return authService.listPermissionCatalog(module, q, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/roles")
  public PagedResult<AuthDtos.RoleCatalogItem> listRoleCatalog(
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return authService.listRoleCatalog(q, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/business-roles")
  public List<AuthDtos.BusinessRoleCatalogItem> listBusinessRoles() {
    return authService.listBusinessRoles();
  }

  @PostMapping("/users/{userId}/roles")
  public AuthDtos.UserRoleAssignment assignRole(
      @PathVariable long userId,
      @Valid @RequestBody AuthDtos.AssignRoleRequest request
  ) {
    return authService.assignRoleToUser(userId, request);
  }

  @PostMapping("/users/{userId}/roles/revoke")
  public void revokeRole(
      @PathVariable long userId,
      @Valid @RequestBody AuthDtos.RevokeRoleRequest request
  ) {
    authService.revokeRoleFromUser(userId, request);
  }

  @PostMapping("/users/{userId}/permissions")
  public AuthDtos.UserPermissionGrant grantPermission(
      @PathVariable long userId,
      @Valid @RequestBody AuthDtos.GrantPermissionRequest request
  ) {
    return authService.grantPermissionToUser(userId, request);
  }

  @PostMapping("/users/{userId}/permissions/revoke")
  public void revokePermission(
      @PathVariable long userId,
      @Valid @RequestBody AuthDtos.RevokePermissionRequest request
  ) {
    authService.revokePermissionFromUser(userId, request);
  }

  @PutMapping("/users/{userId}/status")
  public AuthDtos.UserSummary updateUserStatus(
      @PathVariable long userId,
      @Valid @RequestBody AuthDtos.UpdateUserStatusRequest request
  ) {
    return authService.updateUserStatus(userId, request);
  }

  @PutMapping("/roles/{roleCode}/permissions")
  public AuthDtos.RolePermissionsResponse updateRolePermissions(
      @PathVariable String roleCode,
      @Valid @RequestBody AuthDtos.UpdateRolePermissionsRequest request
  ) {
    return authService.updateRolePermissions(roleCode, request);
  }

  private void writeSessionCookie(HttpServletResponse response, String token, Instant expiresAt) {
    ResponseCookie.ResponseCookieBuilder builder = ResponseCookie.from(authCookieName, token)
        .httpOnly(true)
        .secure(authCookieSecure)
        .sameSite(authCookieSameSite)
        .path("/");
    if (expiresAt != null) {
      long maxAgeSeconds = Math.max(0L, Duration.between(Instant.now(), expiresAt).getSeconds());
      builder.maxAge(Duration.ofSeconds(maxAgeSeconds));
    }
    if (authCookieDomain != null && !authCookieDomain.isBlank()) {
      builder.domain(authCookieDomain.trim());
    }
    response.addHeader(HttpHeaders.SET_COOKIE, builder.build().toString());
  }

  private void clearSessionCookie(HttpServletResponse response) {
    ResponseCookie.ResponseCookieBuilder builder = ResponseCookie.from(authCookieName, "")
        .httpOnly(true)
        .secure(authCookieSecure)
        .sameSite(authCookieSameSite)
        .path("/")
        .maxAge(Duration.ZERO);
    if (authCookieDomain != null && !authCookieDomain.isBlank()) {
      builder.domain(authCookieDomain.trim());
    }
    response.addHeader(HttpHeaders.SET_COOKIE, builder.build().toString());
  }
}
