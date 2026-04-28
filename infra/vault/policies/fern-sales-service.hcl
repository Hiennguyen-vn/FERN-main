path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/sales-service" { capabilities = ["read"] }
path "kv/data/fern/services/sales-service/*" { capabilities = ["read"] }
path "database/creds/fern-sales-service" { capabilities = ["read"] }
