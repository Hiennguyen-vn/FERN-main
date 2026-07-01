package com.fern.services.sync.tier.master;

import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.shared.SyncTier;
import com.fern.services.sync.tier.SyncTierProfile;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class MasterTierProfile implements SyncTierProfile {

  private static final Set<AggregateType> PUSH_UP = Set.of();

  private static final Set<AggregateType> PULL_DOWN = Set.of(
      AggregateType.PRODUCT,
      AggregateType.CATEGORY,
      AggregateType.MENU,
      AggregateType.PRICE_POLICY,
      AggregateType.PROMOTION,
      AggregateType.STORE_CONFIG,
      AggregateType.ITEM_AVAILABILITY,
      AggregateType.TAX_POLICY,
      AggregateType.PAYMENT_METHOD
  );

  @Override
  public SyncTier tier() {
    return SyncTier.MASTER;
  }

  @Override
  public boolean upstreamEnabled() {
    return false;
  }

  @Override
  public boolean downstreamEnabled() {
    return true;
  }

  @Override
  public Set<AggregateType> pushUpAggregates() {
    return PUSH_UP;
  }

  @Override
  public Set<AggregateType> pullDownAggregates() {
    return PULL_DOWN;
  }
}
