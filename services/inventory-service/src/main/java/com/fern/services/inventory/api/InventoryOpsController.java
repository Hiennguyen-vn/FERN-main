package com.fern.services.inventory.api;

import com.fern.services.inventory.application.InventoryService;
import com.fern.services.inventory.infrastructure.InventoryRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/inventory/ops")
public class InventoryOpsController {

  private final InventoryRepository inventoryRepository;
  private final InventoryService inventoryService;

  public InventoryOpsController(InventoryRepository inventoryRepository, InventoryService inventoryService) {
    this.inventoryRepository = inventoryRepository;
    this.inventoryService = inventoryService;
  }

  @GetMapping("/failed-goods-receipts")
  public Map<String, Object> listFailedGoodsReceipts(
      @RequestParam(defaultValue = "100") int limit
  ) {
    int lim = Math.min(Math.max(limit, 1), 1000);
    List<InventoryRepository.StuckGoodsReceiptView> stuck =
        inventoryRepository.listPostedGoodsReceiptsMissingInventory(lim);
    List<InventoryRepository.FailedGoodsReceiptIdempotencyView> failedIdempotency =
        inventoryRepository.listFailedGoodsReceiptIdempotency(lim);
    List<Map<String, Object>> outboxDlt = inventoryRepository.listGoodsReceiptOutboxDltPending(lim);
    return Map.of(
        "stuckGoodsReceipts", stuck,
        "failedIdempotency", failedIdempotency,
        "outboxDlt", outboxDlt,
        "count", stuck.size() + failedIdempotency.size() + outboxDlt.size()
    );
  }

  @PostMapping("/goods-receipts/{goodsReceiptId}/reprocess")
  public Map<String, Object> reprocessGoodsReceipt(@PathVariable long goodsReceiptId) {
    InventoryService.ReprocessGoodsReceiptResult result =
        inventoryService.reprocessGoodsReceiptPosted(goodsReceiptId);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("goodsReceiptId", result.goodsReceiptId());
    body.put("movementsInserted", result.movementsInserted());
    body.put("linkedCount", result.linkedCount());
    body.put("itemCount", result.itemCount());
    body.put("failedIdempotencyKeysCleared", result.failedIdempotencyKeysCleared());
    body.put("alreadyComplete", result.alreadyComplete());
    body.put("reprocessed", !result.alreadyComplete());
    return body;
  }

  @PostMapping("/outbox-dlt/{eventId}/replay")
  public Map<String, Object> replayGoodsReceiptOutboxDlt(@PathVariable long eventId) {
    int updated = inventoryRepository.requeueGoodsReceiptOutboxDlt(eventId);
    return Map.of("eventId", eventId, "requeued", updated > 0);
  }
}
