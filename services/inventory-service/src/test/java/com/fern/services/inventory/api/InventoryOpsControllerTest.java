package com.fern.services.inventory.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.services.inventory.application.InventoryService;
import com.fern.services.inventory.infrastructure.InventoryRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class InventoryOpsControllerTest {

  @Mock
  private InventoryRepository inventoryRepository;
  @Mock
  private InventoryService inventoryService;

  @InjectMocks
  private InventoryOpsController controller;

  @Test
  void listFailedGoodsReceiptsAggregatesStuckViews() {
    List<InventoryRepository.StuckGoodsReceiptView> stuck = List.of(
        new InventoryRepository.StuckGoodsReceiptView(6101L, "posted", 3, 0));
    List<InventoryRepository.FailedGoodsReceiptIdempotencyView> failed = List.of(
        new InventoryRepository.FailedGoodsReceiptIdempotencyView(
            6101L, "evt:6101", "failed", Instant.parse("2026-04-27T10:00:00Z")));
    List<Map<String, Object>> outbox = List.of(Map.of("id", 9001L));
    when(inventoryRepository.listPostedGoodsReceiptsMissingInventory(100)).thenReturn(stuck);
    when(inventoryRepository.listFailedGoodsReceiptIdempotency(100)).thenReturn(failed);
    when(inventoryRepository.listGoodsReceiptOutboxDltPending(100)).thenReturn(outbox);

    Map<String, Object> result = controller.listFailedGoodsReceipts(100);

    assertEquals(3, result.get("count"));
    assertEquals(stuck, result.get("stuckGoodsReceipts"));
    assertEquals(failed, result.get("failedIdempotency"));
    assertEquals(outbox, result.get("outboxDlt"));
  }

  @Test
  void reprocessGoodsReceiptReturnsServiceResult() {
    InventoryService.ReprocessGoodsReceiptResult serviceResult =
        new InventoryService.ReprocessGoodsReceiptResult(6101L, 2, 2, 2, 1, false);
    when(inventoryService.reprocessGoodsReceiptPosted(6101L)).thenReturn(serviceResult);

    Map<String, Object> result = controller.reprocessGoodsReceipt(6101L);

    assertEquals(6101L, result.get("goodsReceiptId"));
    assertEquals(2, result.get("movementsInserted"));
    assertTrue((Boolean) result.get("reprocessed"));
    verify(inventoryService).reprocessGoodsReceiptPosted(6101L);
  }

  @Test
  void replayGoodsReceiptOutboxDltDelegatesToRepository() {
    when(inventoryRepository.requeueGoodsReceiptOutboxDlt(9001L)).thenReturn(1);

    Map<String, Object> result = controller.replayGoodsReceiptOutboxDlt(9001L);

    assertEquals(9001L, result.get("eventId"));
    assertTrue((Boolean) result.get("requeued"));
  }
}
