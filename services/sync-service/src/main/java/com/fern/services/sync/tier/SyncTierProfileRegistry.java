package com.fern.services.sync.tier;

import com.fern.services.sync.application.SyncProperties;
import com.fern.services.sync.shared.SyncTier;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class SyncTierProfileRegistry {

  private final List<SyncTierProfile> profiles;
  private final SyncProperties properties;

  public SyncTierProfileRegistry(List<SyncTierProfile> profiles, SyncProperties properties) {
    this.profiles = profiles;
    this.properties = properties;
  }

  public SyncTierProfile currentProfile() {
    SyncTier tier = properties.effectiveTier();
    return profiles.stream()
        .filter(profile -> profile.tier() == tier)
        .findFirst()
        .orElseThrow(() -> new IllegalStateException("No sync tier profile registered for " + tier));
  }
}
