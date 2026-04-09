package com.dorabets.common.spring.web;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.function.Function;

public record PagedResult<T>(
    List<T> items,
    int limit,
    int offset,
    long totalCount,
    boolean hasNextPage
) {

  public PagedResult {
    items = items == null ? List.of() : List.copyOf(items);
    limit = Math.max(limit, 0);
    offset = Math.max(offset, 0);
    totalCount = Math.max(totalCount, 0);
  }

  public static <T> PagedResult<T> of(List<T> items, int limit, int offset, long totalCount) {
    List<T> safeItems = items == null ? List.of() : List.copyOf(items);
    return new PagedResult<>(safeItems, limit, offset, totalCount, offset + safeItems.size() < totalCount);
  }

  public <R> PagedResult<R> map(Function<? super T, ? extends R> mapper) {
    List<R> mappedItems = new java.util.ArrayList<>(items.size());
    for (T item : items) {
      mappedItems.add(mapper.apply(item));
    }
    return new PagedResult<>(
        mappedItems,
        limit,
        offset,
        totalCount,
        hasNextPage
    );
  }

  @JsonProperty("total")
  public long total() {
    return totalCount;
  }

  @JsonProperty("hasMore")
  public boolean hasMore() {
    return hasNextPage;
  }
}
