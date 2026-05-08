package com.fern.services.auth.spring.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class AuthDtos {

  private AuthDtos() {
  }

  public record LoginRequest(
      @NotBlank String username,
      @NotBlank String password
  ) {
  }

  public record LoginResponse(
      String accessToken,
      long expiresInSeconds,
      UserSummary user,
      Map<Long, Set<String>> rolesByOutlet,
      Map<Long, Set<String>> permissionsByOutlet,
      List<BusinessScopeView> scopeAssignments,
      String sessionId,
      Instant issuedAt,
      Instant expiresAt,
      /**
       * Role codes resolved to their canonical form (e.g. "cashier" → "staff",
       * "finance_manager" → "finance") using the backend {@code RoleAliasResolver}.
       * Frontend MUST use this field for routing/UI decisions instead of maintaining
       * its own alias map, which would drift whenever new roles are added to the backend.
       */
      Map<Long, Set<String>> canonicalRolesByOutlet
  ) {
  }

  public record OutletAccessAssignment(
      @NotNull Long outletId,
      Set<String> roles,
      Set<String> permissions
  ) {
  }

  public record ScopeAssignmentRequest(
      @NotBlank String scopeType,
      @NotBlank String scopeId,
      Set<String> roles,
      Set<String> permissions
  ) {
  }

  public record CreateUserRequest(
      @NotBlank String username,
      @NotBlank String password,
      @NotBlank String fullName,
      String employeeCode,
      String email,
      @Valid List<OutletAccessAssignment> outletAccess,
      @Valid List<ScopeAssignmentRequest> scopeAssignments
  ) {
  }

  public record UpdateRolePermissionsRequest(
      @NotEmpty Set<@NotBlank String> permissionCodes
  ) {
  }

  public record MeResponse(
      UserSummary user,
      Map<Long, Set<String>> rolesByOutlet,
      Map<Long, Set<String>> permissionsByOutlet,
      List<BusinessScopeView> scopeAssignments,
      String sessionId,
      Instant issuedAt,
      Instant expiresAt,
      /** @see LoginResponse#canonicalRolesByOutlet() */
      Map<Long, Set<String>> canonicalRolesByOutlet
  ) {
  }

  public record LogoutResponse(
      String sessionId,
      Instant revokedAt
  ) {
  }

  public record SessionView(
      String sessionId,
      String state,
      Instant issuedAt,
      Instant expiresAt,
      Instant refreshedAt,
      Instant revokedAt,
      Long revokedByUserId,
      String revokeReason,
      String userAgent,
      String clientIp,
      boolean current
  ) {
  }

  public record UserSummary(
      long id,
      String username,
      String fullName,
      String employeeCode,
      String email,
      String phone,
      String status
  ) {
  }

  public record UpdateProfileRequest(
      @NotBlank @Size(max = 150) String fullName,
      @Email @Size(max = 150) String email,
      @Size(max = 30) String phone
  ) {
  }

  public record ChangePasswordRequest(
      @NotBlank String currentPassword,
      @NotBlank @Size(min = 8, max = 100) String newPassword
  ) {
  }

  public record UserListItem(
      long id,
      String username,
      String fullName,
      String employeeCode,
      String email,
      String status,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record UserScopeView(
      long userId,
      String username,
      String fullName,
      String userStatus,
      long outletId,
      String outletCode,
      String outletName,
      Set<String> roles,
      Set<String> permissions
  ) {
  }

  public record UserPermissionOverrideView(
      long userId,
      String username,
      String fullName,
      String userStatus,
      long outletId,
      String outletCode,
      String outletName,
      String permissionCode,
      String permissionName,
      Instant assignedAt
  ) {
  }

  public record PermissionCatalogItem(
      String code,
      String name,
      String description,
      String module,
      boolean published,
      long assignedRoleCount,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record RoleCatalogItem(
      String code,
      String name,
      String description,
      boolean published,
      long assignedPermissionCount,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record RolePermissionsResponse(
      String roleCode,
      Set<String> permissionCodes,
      Instant updatedAt
  ) {
  }

  public record BusinessScopeView(
      String scopeType,
      String scopeId,
      String scopeCode,
      Set<String> roles,
      Set<Long> outletIds
  ) {
  }

  public record BusinessRoleCatalogItem(
      String code,
      String name,
      String description,
      String scopeType,
      Set<String> aliases
  ) {
  }

  /* ── Existing-user mutation DTOs ── */

  public record AssignRoleRequest(
      @NotBlank String outletId,
      @NotBlank String roleCode
  ) {
    public long outletIdAsLong() { return Long.parseLong(outletId.trim()); }
  }

  public record RevokeRoleRequest(
      @NotBlank String outletId,
      @NotBlank String roleCode
  ) {
    public long outletIdAsLong() { return Long.parseLong(outletId.trim()); }
  }

  public record GrantPermissionRequest(
      @NotBlank String outletId,
      @NotBlank String permissionCode
  ) {
    public long outletIdAsLong() { return Long.parseLong(outletId.trim()); }
  }

  public record RevokePermissionRequest(
      @NotBlank String outletId,
      @NotBlank String permissionCode
  ) {
    public long outletIdAsLong() { return Long.parseLong(outletId.trim()); }
  }

  public record UpdateUserStatusRequest(
      @NotBlank String status
  ) {
  }

  public record UserRoleAssignment(
      long userId,
      String roleCode,
      long outletId,
      Instant createdAt
  ) {
  }

  public record UserPermissionGrant(
      long userId,
      String permissionCode,
      long outletId,
      Instant createdAt
  ) {
  }

  public record LeaseOfflineRequest(
      long deviceId
  ) {
  }

  public record LeaseOfflineResponse(
      String offlineToken,
      long expiresInSeconds,
      Instant offlineGraceUntil
  ) {
  }

  /* ── S3: Device pairing ── */

  public record DevicePairTokenRequest(
      @NotNull Long outletId,
      @NotBlank String deviceLabel,
      @NotNull Integer workerId
  ) {
  }

  public record DevicePairTokenResponse(
      long pairTokenId,
      String pairToken,
      long outletId,
      String deviceLabel,
      Instant expiresAt
  ) {
  }

  public record DeviceRedeemRequest(
      @NotBlank String pairToken
  ) {
  }

  public record DeviceTokenResponse(
      long deviceId,
      long outletId,
      String deviceLabel,
      int workerId,
      String deviceToken,
      long expiresInSeconds,
      Instant expiresAt,
      Instant pairedAt
  ) {
  }

  public record DeviceRefreshResponse(
      long deviceId,
      long outletId,
      String deviceToken,
      long expiresInSeconds,
      Instant expiresAt
  ) {
  }

  public record DeviceView(
      long id,
      long outletId,
      String deviceLabel,
      int workerId,
      Instant pairedAt,
      Instant lastSeenAt,
      Instant revokedAt
  ) {
  }
}
