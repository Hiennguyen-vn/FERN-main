"""Create OpenSearch indices: ai_aliases + ai_templates + ai_catalog + ai_metadata with KNN enabled.

Usage:
    python scripts/opensearch_setup.py
"""
import sys

from opensearchpy import OpenSearch

from app.config import get_settings


VI_ANALYZER = {
    "analysis": {
        "analyzer": {
            "vi_standard": {
                "type": "custom",
                "tokenizer": "standard",
                "filter": ["lowercase", "asciifolding"],
            }
        }
    }
}

SINGLE_NODE_KNN_INDEX = {
    "knn": True,
    "number_of_shards": 1,
    "number_of_replicas": 0,
}

ALIASES_BODY = {
    "settings": {
        "index": SINGLE_NODE_KNN_INDEX,
        **VI_ANALYZER,
    },
    "mappings": {
        "properties": {
            "alias_vi":       {"type": "text", "analyzer": "vi_standard"},
            "canonical_type": {"type": "keyword"},
            "canonical_id":   {"type": "long"},
            "canonical_name": {"type": "keyword"},
            "embedding": {
                "type": "knn_vector",
                "dimension": 1536,
                "method": {"name": "hnsw", "engine": "lucene", "space_type": "cosinesimil"},
            },
        }
    },
}

TEMPLATES_BODY = {
    "settings": {
        "index": SINGLE_NODE_KNN_INDEX,
        **VI_ANALYZER,
    },
    "mappings": {
        "properties": {
            "template_key":    {"type": "keyword"},
            "description_vi":  {"type": "text", "analyzer": "vi_standard"},
            "intent":          {"type": "keyword"},
            "required_params": {"type": "keyword"},
            "embedding": {
                "type": "knn_vector",
                "dimension": 1536,
                "method": {"name": "hnsw", "engine": "lucene", "space_type": "cosinesimil"},
            },
        }
    },
}

CATALOG_BODY = {
    "settings": {
        "index": SINGLE_NODE_KNN_INDEX,
        **VI_ANALYZER,
    },
    "mappings": {
        "properties": {
            "full_table": {"type": "keyword"},
            "summary_vi": {"type": "text", "analyzer": "vi_standard"},
            "embedding": {
                "type": "knn_vector",
                "dimension": 1536,
                "method": {"name": "hnsw", "engine": "lucene", "space_type": "cosinesimil"},
            },
        }
    },
}

METADATA_BODY = {
    "settings": {
        "index": SINGLE_NODE_KNN_INDEX,
        **VI_ANALYZER,
    },
    "mappings": {
        "properties": {
            "doc_type": {"type": "keyword"},
            "canonical_type": {"type": "keyword"},
            "canonical_name": {"type": "keyword"},
            "full_table": {"type": "keyword"},
            "aliases": {"type": "text", "analyzer": "vi_standard"},
            "search_text": {"type": "text", "analyzer": "vi_standard"},
            "definition_vi": {"type": "text", "analyzer": "vi_standard"},
            "summary_vi": {"type": "text", "analyzer": "vi_standard"},
            "embedding": {
                "type": "knn_vector",
                "dimension": 1536,
                "method": {"name": "hnsw", "engine": "lucene", "space_type": "cosinesimil"},
            },
        }
    },
}


def main():
    s = get_settings()
    client = OpenSearch(hosts=[s.opensearch_url], verify_certs=False, ssl_show_warn=False)

    indices = [
        (s.opensearch_aliases_index, ALIASES_BODY),
        (s.opensearch_templates_index, TEMPLATES_BODY),
        (s.opensearch_catalog_index, CATALOG_BODY),
        (s.opensearch_metadata_index, METADATA_BODY),
    ]
    for index, body in indices:
        if client.indices.exists(index=index):
            print(f"Index {index} exists, skipping.")
            continue
        client.indices.create(index=index, body=body)
        print(f"Created index: {index}")


if __name__ == "__main__":
    sys.exit(main())
