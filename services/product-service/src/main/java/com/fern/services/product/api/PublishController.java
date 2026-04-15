package com.fern.services.product.api;

import com.fern.services.product.application.PublishService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/product")
public class PublishController {

  private final PublishService publishService;

  public PublishController(PublishService publishService) {
    this.publishService = publishService;
  }

  // ── Versions ──────────────────────────────────────────

  @GetMapping("/publish/versions")
  public List<PublishDtos.PublishVersionView> listVersions(
      @RequestParam(required = false) String status,
      @RequestParam(defaultValue = "50") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return publishService.listVersions(status, limit, offset);
  }

  @GetMapping("/publish/versions/{versionId}")
  public PublishDtos.PublishVersionView getVersion(@PathVariable long versionId) {
    return publishService.getVersion(versionId);
  }

  @PostMapping("/publish/versions")
  @ResponseStatus(HttpStatus.CREATED)
  public PublishDtos.PublishVersionView createVersion(
      @Valid @RequestBody PublishDtos.CreatePublishVersionRequest request
  ) {
    return publishService.createVersion(request);
  }

  // ── Items ─────────────────────────────────────────────

  @GetMapping("/publish/versions/{versionId}/items")
  public List<PublishDtos.PublishItemView> listItems(@PathVariable long versionId) {
    return publishService.listItems(versionId);
  }

  @PostMapping("/publish/versions/{versionId}/items")
  @ResponseStatus(HttpStatus.CREATED)
  public PublishDtos.PublishItemView addItem(
      @PathVariable long versionId,
      @Valid @RequestBody PublishDtos.AddPublishItemRequest request
  ) {
    return publishService.addItem(versionId, request);
  }

  @DeleteMapping("/publish/items/{itemId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void removeItem(@PathVariable long itemId) {
    publishService.removeItem(itemId);
  }

  // ── Workflow ──────────────────────────────────────────

  @PostMapping("/publish/versions/{versionId}/submit")
  public PublishDtos.PublishVersionView submitForReview(
      @PathVariable long versionId,
      @RequestBody(required = false) PublishDtos.SubmitReviewRequest request
  ) {
    return publishService.submitForReview(versionId, request);
  }

  @PostMapping("/publish/versions/{versionId}/review")
  public PublishDtos.PublishVersionView reviewDecision(
      @PathVariable long versionId,
      @Valid @RequestBody PublishDtos.ReviewDecisionRequest request
  ) {
    return publishService.reviewDecision(versionId, request);
  }

  @PostMapping("/publish/versions/{versionId}/publish")
  public PublishDtos.PublishVersionView publish(@PathVariable long versionId) {
    return publishService.publish(versionId);
  }

  @PostMapping("/publish/versions/{versionId}/schedule")
  public PublishDtos.PublishVersionView schedule(
      @PathVariable long versionId,
      @Valid @RequestBody PublishDtos.SchedulePublishRequest request
  ) {
    return publishService.schedule(versionId, request);
  }

  @PostMapping("/publish/versions/{versionId}/rollback")
  public PublishDtos.PublishVersionView rollback(
      @PathVariable long versionId,
      @RequestBody(required = false) PublishDtos.RollbackRequest request
  ) {
    return publishService.rollback(versionId, request);
  }

  // ── Audit log ─────────────────────────────────────────

  @GetMapping("/audit-log")
  public List<PublishDtos.AuditLogView> listAuditLog(
      @RequestParam(required = false) String entityType,
      @RequestParam(required = false) Long entityId,
      @RequestParam(required = false) Long userId,
      @RequestParam(defaultValue = "50") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return publishService.listAuditLog(entityType, entityId, userId, limit, offset);
  }
}
