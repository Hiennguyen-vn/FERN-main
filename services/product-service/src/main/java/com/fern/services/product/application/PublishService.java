package com.fern.services.product.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.BusinessUserProfile;
import com.dorabets.common.spring.auth.CanonicalRole;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.fern.services.product.api.PublishDtos;
import com.fern.services.product.infrastructure.PublishRepository;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class PublishService {

  private static final Set<String> VALID_SUBMIT_FROM = Set.of("draft");
  private static final Set<String> VALID_REVIEW_FROM = Set.of("review");
  private static final Set<String> VALID_PUBLISH_FROM = Set.of("approved", "scheduled");
  private static final Set<String> VALID_ROLLBACK_FROM = Set.of("published");

  private final PublishRepository publishRepository;
  private final AuthorizationPolicyService authorizationPolicyService;

  public PublishService(PublishRepository publishRepository, AuthorizationPolicyService authorizationPolicyService) {
    this.publishRepository = publishRepository;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  public List<PublishDtos.PublishVersionView> listVersions(String status, int limit, int offset) {
    return publishRepository.listVersions(status, Math.min(limit, 200), Math.max(offset, 0));
  }

  public PublishDtos.PublishVersionView getVersion(long id) {
    return publishRepository.findVersion(id)
        .orElseThrow(() -> ServiceException.notFound("Publish version not found: " + id));
  }

  public PublishDtos.PublishVersionView createVersion(PublishDtos.CreatePublishVersionRequest request) {
    requireCatalogMutation();
    long userId = RequestUserContextHolder.get().requireUserId();
    return publishRepository.createVersion(request.name(), request.description(), userId);
  }

  public List<PublishDtos.PublishItemView> listItems(long versionId) {
    return publishRepository.listItems(versionId);
  }

  public PublishDtos.PublishItemView addItem(long versionId, PublishDtos.AddPublishItemRequest request) {
    requireCatalogMutation();
    requireStatus(versionId, "draft");
    return publishRepository.addItem(versionId, request);
  }

  public void removeItem(long itemId) {
    requireCatalogMutation();
    publishRepository.removeItem(itemId);
  }

  public PublishDtos.PublishVersionView submitForReview(long versionId, PublishDtos.SubmitReviewRequest request) {
    requireCatalogMutation();
    requireStatus(versionId, VALID_SUBMIT_FROM);
    long userId = RequestUserContextHolder.get().requireUserId();
    publishRepository.updateStatus(versionId, "review", userId);
    if (request != null && request.note() != null) {
      publishRepository.setReviewNote(versionId, request.note());
    }
    logAudit("publish_version", versionId, "status_change", null, "draft", "review", userId);
    return getVersion(versionId);
  }

  public PublishDtos.PublishVersionView reviewDecision(long versionId, PublishDtos.ReviewDecisionRequest request) {
    requireReviewPermission();
    requireStatus(versionId, VALID_REVIEW_FROM);
    long userId = RequestUserContextHolder.get().requireUserId();
    String newStatus = "approve".equals(request.decision()) ? "approved" : "rejected";
    publishRepository.updateStatus(versionId, newStatus, userId);
    if (request.note() != null) {
      publishRepository.setReviewNote(versionId, request.note());
    }
    logAudit("publish_version", versionId, "status_change", null, "review", newStatus, userId);
    return getVersion(versionId);
  }

  public PublishDtos.PublishVersionView publish(long versionId) {
    requireCatalogMutation();
    requireStatus(versionId, VALID_PUBLISH_FROM);
    long userId = RequestUserContextHolder.get().requireUserId();
    publishRepository.updateStatus(versionId, "published", userId);
    logAudit("publish_version", versionId, "publish", null, "approved", "published", userId);
    return getVersion(versionId);
  }

  public PublishDtos.PublishVersionView schedule(long versionId, PublishDtos.SchedulePublishRequest request) {
    requireCatalogMutation();
    requireStatus(versionId, Set.of("approved"));
    publishRepository.updateStatus(versionId, "scheduled", null);
    publishRepository.setScheduledAt(versionId, request.scheduledAt());
    return getVersion(versionId);
  }

  public PublishDtos.PublishVersionView rollback(long versionId, PublishDtos.RollbackRequest request) {
    requireSuperadmin();
    requireStatus(versionId, VALID_ROLLBACK_FROM);
    long userId = RequestUserContextHolder.get().requireUserId();
    if (request != null && request.reason() != null) {
      publishRepository.setRollbackReason(versionId, request.reason());
    }
    publishRepository.updateStatus(versionId, "rolled_back", userId);
    logAudit("publish_version", versionId, "rollback", null, "published", "rolled_back", userId);
    return getVersion(versionId);
  }

  // ── Audit log ──

  public List<PublishDtos.AuditLogView> listAuditLog(String entityType, Long entityId, Long userId, int limit, int offset) {
    return publishRepository.listAuditLog(entityType, entityId, userId, Math.min(limit, 200), Math.max(offset, 0));
  }

  // ── Helpers ──

  private void requireStatus(long versionId, String expected) {
    requireStatus(versionId, Set.of(expected));
  }

  private void requireStatus(long versionId, Set<String> expected) {
    PublishDtos.PublishVersionView v = getVersion(versionId);
    if (!expected.contains(v.status())) {
      throw ServiceException.badRequest("Version status must be one of " + expected + " but is " + v.status());
    }
  }

  private void requireCatalogMutation() {
    if (!authorizationPolicyService.canMutateCatalog(RequestUserContextHolder.get())) {
      throw ServiceException.forbidden("Catalog mutation access required");
    }
  }

  private void requireReviewPermission() {
    RequestUserContext ctx = RequestUserContextHolder.get();
    if (ctx.internalService()) return;
    long userId = ctx.requireUserId();
    BusinessUserProfile profile = authorizationPolicyService.resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) return;
    if (profile.canonicalRoles().contains(CanonicalRole.REGION_MANAGER)) return;
    throw ServiceException.forbidden("Review permission requires superadmin or region_manager role");
  }

  private void requireSuperadmin() {
    RequestUserContext ctx = RequestUserContextHolder.get();
    if (ctx.internalService()) return;
    long userId = ctx.requireUserId();
    BusinessUserProfile profile = authorizationPolicyService.resolveUserProfile(userId);
    if (!profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      throw ServiceException.forbidden("Rollback requires superadmin role");
    }
  }

  private void logAudit(String entityType, long entityId, String action, String field, String oldVal, String newVal, long userId) {
    try {
      publishRepository.writeAuditLog(entityType, entityId, action, field, oldVal, newVal, null, null, userId, null, null);
    } catch (Exception ignored) { /* audit logging should not break workflow */ }
  }
}
