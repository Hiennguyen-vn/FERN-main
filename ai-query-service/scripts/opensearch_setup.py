"""Create OpenSearch indices: ai_aliases + ai_templates with KNN enabled.

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

ALIASES_BODY = {
    "settings": {
        "index": {"knn": True},
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
        "index": {"knn": True},
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


def main():
    s = get_settings()
    client = OpenSearch(hosts=[s.opensearch_url], verify_certs=False, ssl_show_warn=False)

    for index, body in [(s.opensearch_aliases_index, ALIASES_BODY), (s.opensearch_templates_index, TEMPLATES_BODY)]:
        if client.indices.exists(index=index):
            print(f"Index {index} exists, skipping.")
            continue
        client.indices.create(index=index, body=body)
        print(f"Created index: {index}")


if __name__ == "__main__":
    sys.exit(main())
