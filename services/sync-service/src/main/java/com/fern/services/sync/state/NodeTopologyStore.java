package com.fern.services.sync.state;

import java.util.Optional;

public interface NodeTopologyStore {

  Optional<NodeTopology> findNodeTopology(String nodeId);

  Optional<NodeTopology> findManagedChild(String parentNodeId, long storeId);

  java.util.List<NodeTopology> listManagedChildren(String parentNodeId);

  java.util.List<NodeTopology> listManagedChildrenByStoreIds(String parentNodeId, java.util.List<Long> storeIds);

  record NodeTopology(
      String nodeId,
      long storeId,
      String parentNodeId,
      String managedScopeType,
      Long managedScopeId,
      String runtimeRole,
      String status
  ) {
  }
}
