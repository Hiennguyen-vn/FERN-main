path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/inventory-service" { capabilities = ["read"] }
path "kv/data/fern/services/inventory-service/*" { capabilities = ["read"] }
path "database/creds/fern-inventory-service" { capabilities = ["read"] }
