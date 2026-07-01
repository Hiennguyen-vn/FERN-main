package com.fern.services.sync.tier;

import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.shared.SyncTier;
import java.util.Set;

public interface SyncTierProfile {

  SyncTier tier();

  boolean upstreamEnabled();

  boolean downstreamEnabled();

  Set<AggregateType> pushUpAggregates();

  Set<AggregateType> pullDownAggregates();
}
