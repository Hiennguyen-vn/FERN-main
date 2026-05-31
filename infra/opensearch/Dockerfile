FROM opensearchproject/opensearch:2.12.0

USER root

# Local ai-query only needs BM25 plus the k-NN plugin for vector fields.
# The stock image starts many analytics/ML/security plugin background jobs,
# which can OOM small local Docker environments.
RUN set -eux; \
    plugins=" \
      opensearch-security-analytics \
      opensearch-observability \
      opensearch-reports-scheduler \
      opensearch-neural-search \
      opensearch-skills \
      opensearch-flow-framework \
      opensearch-ml \
      opensearch-anomaly-detection \
      opensearch-alerting \
      opensearch-notifications \
      opensearch-notifications-core \
      opensearch-sql \
      opensearch-asynchronous-search \
      opensearch-cross-cluster-replication \
      opensearch-geospatial \
      opensearch-index-management \
      opensearch-job-scheduler \
      opensearch-performance-analyzer \
      opensearch-security \
    "; \
    for plugin in ${plugins}; do \
      if /usr/share/opensearch/bin/opensearch-plugin list | grep -qx "${plugin}"; then \
        /usr/share/opensearch/bin/opensearch-plugin remove --purge "${plugin}"; \
      fi; \
    done

USER opensearch
