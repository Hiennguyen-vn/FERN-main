path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/product-service" { capabilities = ["read"] }
path "kv/data/fern/services/product-service/*" { capabilities = ["read"] }
path "database/creds/fern-product-service" { capabilities = ["read"] }
