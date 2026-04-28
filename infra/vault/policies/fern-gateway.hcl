path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/gateway" { capabilities = ["read"] }
path "kv/data/fern/services/gateway/*" { capabilities = ["read"] }
path "database/creds/fern-gateway" { capabilities = ["read"] }
