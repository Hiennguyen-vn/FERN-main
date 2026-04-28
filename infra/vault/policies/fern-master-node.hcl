path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/master-node" { capabilities = ["read"] }
path "kv/data/fern/services/master-node/*" { capabilities = ["read"] }
path "database/creds/fern-master-node" { capabilities = ["read"] }
