package com.fern.services.sync.model;

public enum ConflictResolution {
  CENTRAL_WINS,
  STORE_OWNS_APPEND_ONLY,
  APPEND_MOVEMENT,
  GLOBAL_AND_STORE_AVAILABILITY,
  MANUAL_REVIEW
}
