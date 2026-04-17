package com.fern.services.audit.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.idempotency.IdempotencyGuard;
import com.dorabets.idempotency.model.IdempotencyResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.auth.RoleUpdatedEvent;
import com.fern.events.core.EventEnvelope;
import com.fern.events.org.RegionCreatedEvent;
import com.fern.events.product.ProductPriceChangedEvent;
import com.fern.events.sales.SaleCompletedEvent;
import com.fern.events.sales.SaleCompletedLineItem;
import com.fern.services.audit.infrastructure.AuditRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AuditEventConsumerTest {

  @Mock
  private AuditRepository auditRepository;
  @Mock
  private IdempotencyGuard idempotencyGuard;
  @Mock
  private SnowflakeIdGenerator snowflakeIdGenerator;

  private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

  @Test
  void consumeMapsEnvelopeIntoAuditLogEntry() throws Exception {
    AuditEventConsumer consumer = new AuditEventConsumer(
        auditRepository,
        idempotencyGuard,
        objectMapper,
        snowflakeIdGenerator
    );
    SaleCompletedEvent payload = new SaleCompletedEvent(
        55L,
        8L,
        LocalDate.parse("2026-03-27"),
        "USD",
        List.of(new SaleCompletedLineItem(
            99L,
            BigDecimal.ONE,
            new BigDecimal("5.00"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            new BigDecimal("5.00")
        )),
        new BigDecimal("5.00"),
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        new BigDecimal("5.00"),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    String rawMessage = objectMapper.writeValueAsString(
        EventEnvelope.create("sales.sale.completed", "55", payload, "sales-service")
    );

    when(snowflakeIdGenerator.generateId()).thenReturn(777L);
    when(idempotencyGuard.execute(eq("audit-service"), any(), eq(rawMessage), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.consume(rawMessage);

    ArgumentCaptor<AuditRepository.AuditEntry> captor = ArgumentCaptor.forClass(AuditRepository.AuditEntry.class);
    verify(auditRepository).append(captor.capture());
    assertEquals(777L, captor.getValue().id());
    assertEquals("post", captor.getValue().action());
    assertEquals("sale_record", captor.getValue().entityName());
    assertEquals("55", captor.getValue().entityId());
  }

  @Test
  void consumeMapsRoleUpdatedIntoRoleAuditEntry() throws Exception {
    AuditEventConsumer consumer = new AuditEventConsumer(
        auditRepository,
        idempotencyGuard,
        objectMapper,
        snowflakeIdGenerator
    );
    RoleUpdatedEvent payload = new RoleUpdatedEvent(
        "manager",
        java.util.Set.of("product.catalog.write"),
        Instant.parse("2026-03-27T00:00:00Z"),
        7L
    );
    String rawMessage = objectMapper.writeValueAsString(
        EventEnvelope.create("auth.role.updated", "manager", payload, "auth-service")
    );

    when(snowflakeIdGenerator.generateId()).thenReturn(778L);
    when(idempotencyGuard.execute(eq("audit-service"), any(), eq(rawMessage), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.consume(rawMessage);

    ArgumentCaptor<AuditRepository.AuditEntry> captor = ArgumentCaptor.forClass(AuditRepository.AuditEntry.class);
    verify(auditRepository).append(captor.capture());
    assertEquals("update", captor.getValue().action());
    assertEquals("role", captor.getValue().entityName());
    assertEquals("manager", captor.getValue().entityId());
  }

  @Test
  void consumeMapsProductPriceChangeToProductEntityId() throws Exception {
    AuditEventConsumer consumer = new AuditEventConsumer(
        auditRepository,
        idempotencyGuard,
        objectMapper,
        snowflakeIdGenerator
    );
    ProductPriceChangedEvent payload = new ProductPriceChangedEvent(
        501L,
        2000L,
        "VND",
        new BigDecimal("65000.00"),
        new BigDecimal("72000.00"),
        LocalDate.parse("2026-03-27"),
        7L,
        Instant.parse("2026-03-27T00:00:00Z")
    );
    String rawMessage = objectMapper.writeValueAsString(
        EventEnvelope.create("product.price.changed", "501", payload, "product-service")
    );

    when(snowflakeIdGenerator.generateId()).thenReturn(779L);
    when(idempotencyGuard.execute(eq("audit-service"), any(), eq(rawMessage), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.consume(rawMessage);

    ArgumentCaptor<AuditRepository.AuditEntry> captor = ArgumentCaptor.forClass(AuditRepository.AuditEntry.class);
    verify(auditRepository).append(captor.capture());
    assertEquals("product_price", captor.getValue().entityName());
    assertEquals("501", captor.getValue().entityId());
  }

  @Test
  void consumeMapsRegionCreatedIntoRegionAuditEntry() throws Exception {
    AuditEventConsumer consumer = new AuditEventConsumer(
        auditRepository,
        idempotencyGuard,
        objectMapper,
        snowflakeIdGenerator
    );
    RegionCreatedEvent payload = new RegionCreatedEvent(
        88L,
        "VN-CENTRAL",
        1L,
        "VND",
        "Central",
        "VAT",
        "Asia/Ho_Chi_Minh",
        Instant.parse("2026-03-27T00:00:00Z"),
        7L
    );
    String rawMessage = objectMapper.writeValueAsString(
        EventEnvelope.create("org.region.created", "88", payload, "org-service")
    );

    when(snowflakeIdGenerator.generateId()).thenReturn(780L);
    when(idempotencyGuard.execute(eq("audit-service"), any(), eq(rawMessage), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.consume(rawMessage);

    ArgumentCaptor<AuditRepository.AuditEntry> captor = ArgumentCaptor.forClass(AuditRepository.AuditEntry.class);
    verify(auditRepository).append(captor.capture());
    assertEquals("insert", captor.getValue().action());
    assertEquals("region", captor.getValue().entityName());
    assertEquals("88", captor.getValue().entityId());
  }
}
