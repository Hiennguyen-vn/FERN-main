path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/procurement-service" { capabilities = ["read"] }
path "kv/data/fern/services/procurement-service/*" { capabilities = ["read"] }
path "database/creds/fern-procurement-service" { capabilities = ["read"] }
