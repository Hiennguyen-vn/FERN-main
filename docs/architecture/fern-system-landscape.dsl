workspace "FERN ERP Platform" "C4 System Landscape for FERN, split into business-domain software systems." {

    !identifiers hierarchical

    model {
        backOfficeAdmin = person "Back-office Admin" "Quản trị chuỗi: danh mục, mua hàng, kho, nhân sự, lương, tài chính, báo cáo và cấu hình vận hành."
        outletStaff = person "Outlet / POS Staff" "Nhân viên cửa hàng vận hành ca bán, đơn hàng, thanh toán, đồng bộ thiết bị và xử lý tồn kho."
        customer = person "Customer" "Khách hàng đặt món qua QR/table ordering."
        businessAnalyst = person "Business Analyst" "Người dùng khai thác báo cáo, dashboard và đặt câu hỏi dữ liệu bằng ngôn ngữ tự nhiên."
        systemOperator = person "System Operator" "Người vận hành theo dõi health, metrics, traces, service registry và dữ liệu demo."
        developerQa = person "Developer / QA" "Kỹ sư phát triển, kiểm thử, chạy local services, migrations, simulator và smoke tests."

        group "FERN ERP Platform" {
            frontend = softwareSystem "Frontend Web Application" "React/Vite workspace cho admin, POS staff, analyst và customer ordering. Frontend gọi gateway, không gọi trực tiếp service nội bộ." {
                tags "Frontend"
            }

            gateway = softwareSystem "API Gateway" "Spring Cloud Gateway ingress: route catalog, auth/session handling, rate limiting, circuit breaker, header propagation và public/internal route boundary." {
                tags "Platform System"
            }

            auth = softwareSystem "Auth / IAM System" "Login, refresh/session, user, role, permission, device pairing và outlet-scoped authorization context." {
                tags "Business System"
            }

            controlPlane = softwareSystem "Master Control Plane" "Service registry, heartbeat, service discovery, config distribution, feature flags, rollout metadata và health aggregation." {
                tags "Platform System"
            }

            org = softwareSystem "Organization Reference System" "Currency, region, outlet và organizational reference data." {
                tags "Business System"
            }

            product = softwareSystem "Product / Catalog / Pricing System" "Product categories, items, products, allergens, modifier groups, recipes, product availability, tax và outlet pricing." {
                tags "Business System"
            }

            procurement = softwareSystem "Procurement System" "Supplier, purchase order, goods receipt, supplier invoice, supplier payment và payment allocation workflows." {
                tags "Business System"
            }

            sales = softwareSystem "Sales / POS / CRM System" "POS sessions, sale records, payments, promotions, customer ordering, CRM/loyalty, sync-facing sales workflows và telemetry routing." {
                tags "Business System"
            }

            sync = softwareSystem "Sync System" "Device sync service cho edge/POS synchronization và central sync endpoints." {
                tags "Business System"
            }

            inventory = softwareSystem "Inventory System" "Inventory transactions, stock count, waste, goods receipt transactions, manufacturing batches và stock projections." {
                tags "Business System"
            }

            hr = softwareSystem "HR System" "Shift, work shift và employee contract workflows." {
                tags "Business System"
            }

            payroll = softwareSystem "Payroll System" "Payroll periods, timesheets, payroll generation, approval và payroll expense handoff." {
                tags "Business System"
            }

            finance = softwareSystem "Finance System" "Expense records, purchase/payroll/operating/other expenses và finance document workflows." {
                tags "Business System"
            }

            audit = softwareSystem "Audit System" "Audit log persistence và audit-event consumption for traceability." {
                tags "Business System"
            }

            reporting = softwareSystem "Reporting System" "Read-only reporting and aggregate views. Reads from PostgreSQL replica, not primary writes." {
                tags "Insight System"
            }

            aiQuery = softwareSystem "AI Query System" "Natural-language BI/query sidecar with guarded SQL, outlet-scope/RBAC injection, ClickHouse/OpenSearch integrations and LLM calls." {
                tags "Insight System"
            }

            dataSimulator = softwareSystem "Local Data Simulator" "Local-only operational data simulator with preview/execute guardrails." {
                tags "Tool System"
            }
        }

        group "Shared Data and Infrastructure" {
            postgresPrimary = softwareSystem "PostgreSQL Primary" "Shared fern database / core schema. Primary write store shared by FERN systems; not database-per-service." {
                tags "Database System"
            }

            postgresReplica = softwareSystem "PostgreSQL Read Replica" "Streaming standby database for reporting/read-only workloads." {
                tags "Database System"
            }

            pgbouncer = softwareSystem "PgBouncer / HAProxy Pool" "Optional pooled database access path for PostgreSQL primary." {
                tags "Infrastructure System"
            }

            redis = softwareSystem "Redis + Sentinel" "Cache, sessions, rate limits, heartbeat registry, hot config and failover-capable Redis topology." {
                tags "Infrastructure System"
            }

            kafka = softwareSystem "Kafka KRaft" "Event backbone for domain events, audit events, async integration and CDC." {
                tags "Message System"
            }

            kafkaConnect = softwareSystem "Kafka Connect / Debezium" "CDC pipeline from PostgreSQL into Kafka and analytics targets." {
                tags "Message System"
            }

            minioS3 = softwareSystem "S3-compatible Object Storage" "MinIO local or external S3-compatible buckets for product images and finance documents." {
                tags "External System"
            }

            clickhouse = softwareSystem "ClickHouse Analytics Store" "Analytics/CDC store for AI Query and analytical projections." {
                tags "Analytics System"
            }

            opensearch = softwareSystem "OpenSearch" "Search/RAG/runtime catalog indexes for AI Query." {
                tags "Search System"
            }

            observability = softwareSystem "Observability Stack" "Prometheus, Grafana, Jaeger and exporters for health, metrics and traces." {
                tags "Observability System"
            }

            vault = softwareSystem "Vault / Secrets Provider" "Optional secret/config source for service credentials." {
                tags "External System"
            }
        }

        llmProvider = softwareSystem "OpenAI-compatible LLM Provider" "External model provider used by AI Query." {
            tags "External System"
        }

        backOfficeAdmin -> frontend "Uses admin workflows through"
        outletStaff -> frontend "Uses POS/admin workflows through"
        customer -> frontend "Places QR/table orders through"
        businessAnalyst -> frontend "Uses reporting and AI query through"
        systemOperator -> observability "Monitors runtime state through"
        systemOperator -> controlPlane "Inspects service topology and health through"
        developerQa -> dataSimulator "Runs local demo-data simulation through"
        developerQa -> gateway "Runs smoke tests and local API checks against"

        frontend -> gateway "Calls only through"
        outletStaff -> sync "Syncs POS/edge data through device routes"

        gateway -> auth "Routes auth, IAM and device APIs to"
        gateway -> controlPlane "Routes internal control/master APIs to"
        gateway -> org "Routes organization APIs to"
        gateway -> product "Routes catalog/pricing APIs to"
        gateway -> procurement "Routes procurement APIs to"
        gateway -> sales "Routes sales, CRM, public ordering and telemetry APIs to"
        gateway -> sync "Routes device/internal sync APIs to"
        gateway -> inventory "Routes inventory APIs to"
        gateway -> hr "Routes HR APIs to"
        gateway -> payroll "Routes payroll APIs to"
        gateway -> finance "Routes finance APIs to"
        gateway -> audit "Routes audit APIs to"
        gateway -> reporting "Routes reporting APIs to"
        gateway -> aiQuery "Routes AI query APIs to"

        auth -> org "Validates outlet/region assignment context with"
        hr -> auth "Looks up employee/user identity via"
        hr -> org "Uses outlet/region metadata from"
        product -> org "Uses outlet/region context from"
        procurement -> org "Uses outlet/organization reference data from"
        procurement -> product "Uses product/item reference data from"
        sales -> org "Uses outlet context from"
        sales -> product "Uses products, modifiers, recipes and prices from"
        sync -> sales "Exchanges sales sync state with"
        inventory -> product "Uses item/product/recipe metadata from"
        inventory -> org "Uses outlet metadata from"
        payroll -> hr "Uses timesheet/employee data from"
        payroll -> org "Uses outlet/region metadata from"
        finance -> procurement "Consumes purchase/receipt/invoice expense context from"
        finance -> sales "Consumes sales/payment revenue context from"
        finance -> payroll "Consumes payroll expense context from"
        audit -> kafka "Consumes audit/domain events from"
        reporting -> controlPlane "Reads effective config and feature gates from"
        aiQuery -> gateway "Trusts gateway-injected identity/scope headers from"

        auth -> postgresPrimary "Reads/writes IAM and session state"
        controlPlane -> postgresPrimary "Reads/writes control-plane state"
        org -> postgresPrimary "Reads/writes organization reference data"
        product -> postgresPrimary "Reads/writes catalog, recipe and pricing data"
        procurement -> postgresPrimary "Reads/writes procurement state"
        sales -> postgresPrimary "Reads/writes POS, sales, CRM and ordering state"
        sync -> postgresPrimary "Reads/writes sync metadata and state"
        inventory -> postgresPrimary "Reads/writes inventory transaction state"
        hr -> postgresPrimary "Reads/writes HR state"
        payroll -> postgresPrimary "Reads/writes payroll state"
        finance -> postgresPrimary "Reads/writes finance state"
        audit -> postgresPrimary "Writes audit logs"
        dataSimulator -> postgresPrimary "Seeds and cleans local demo data"

        postgresPrimary -> postgresReplica "Streams WAL replication to"
        reporting -> postgresReplica "Reads reporting data from"
        aiQuery -> postgresReplica "Reads guarded operational data from"

        gateway -> redis "Uses rate limiting, route/session cache and hot data"
        auth -> redis "Caches sessions and claims"
        controlPlane -> redis "Stores heartbeat, registry and config cache"
        org -> redis "Caches organization hierarchy"
        product -> redis "Caches product/pricing data"
        sales -> redis "Caches POS/session/revenue data"
        sync -> redis "Uses sync hot state/cache"
        inventory -> redis "Caches stock/reference data"
        aiQuery -> redis "Uses checkpoint/session memory"

        org -> kafka "Publishes organization events to"
        product -> kafka "Publishes catalog/pricing events to"
        procurement -> kafka "Publishes procurement events to"
        sales -> kafka "Publishes sales/CRM events to"
        sync -> kafka "Publishes sync events to"
        inventory -> kafka "Consumes and publishes inventory events via"
        payroll -> kafka "Publishes payroll events to"
        finance -> kafka "Consumes finance-relevant events from"
        audit -> kafka "Consumes audit events from"
        aiQuery -> kafka "Publishes AI query audit/review events to"
        controlPlane -> kafka "Publishes topology/config events to"

        kafkaConnect -> postgresPrimary "Reads CDC changes from"
        kafkaConnect -> kafka "Publishes CDC topics to"
        kafkaConnect -> clickhouse "Loads analytical projections into"
        aiQuery -> clickhouse "Queries analytical data from"
        aiQuery -> opensearch "Searches knowledge/runtime indexes in"
        aiQuery -> llmProvider "Calls model APIs on"

        product -> minioS3 "Stores product images in"
        finance -> minioS3 "Stores finance documents in"
        gateway -> vault "Can load secret-backed configuration from"
        auth -> vault "Can load credentials/configuration from"
        reporting -> vault "Can load replica credentials from"

        gateway -> observability "Exposes health, metrics and traces to"
        auth -> observability "Exposes metrics/traces to"
        org -> observability "Exposes metrics/traces to"
        product -> observability "Exposes metrics/traces to"
        procurement -> observability "Exposes metrics/traces to"
        sales -> observability "Exposes metrics/traces to"
        sync -> observability "Exposes metrics/traces to"
        inventory -> observability "Exposes metrics/traces to"
        hr -> observability "Exposes metrics/traces to"
        payroll -> observability "Exposes metrics/traces to"
        finance -> observability "Exposes metrics/traces to"
        audit -> observability "Exposes metrics/traces to"
        reporting -> observability "Exposes metrics/traces to"
        aiQuery -> observability "Exposes health/telemetry to"
        observability -> postgresPrimary "Scrapes primary database metrics"
        observability -> postgresReplica "Scrapes replica metrics and lag"
        observability -> redis "Scrapes Redis metrics"
        observability -> kafka "Scrapes Kafka metrics"
    }

    views {
        systemLandscape "SystemLandscape" {
            include *
            autoLayout lr
        }

        styles {
            element "Element" {
                color #1f2937
                stroke #6b7280
                strokeWidth 3
                shape roundedbox
            }

            element "Person" {
                shape person
                background #ecfdf5
                color #166534
                stroke #16a34a
                strokeWidth 4
            }

            element "Frontend" {
                background #e0f2fe
                color #075985
                stroke #0284c7
                strokeWidth 5
            }

            element "Platform System" {
                background #eef2ff
                color #3730a3
                stroke #6366f1
                strokeWidth 5
            }

            element "Business System" {
                background #f0fdf4
                color #166534
                stroke #22c55e
                strokeWidth 4
            }

            element "Insight System" {
                background #fdf2f8
                color #9d174d
                stroke #ec4899
                strokeWidth 4
            }

            element "Database System" {
                shape cylinder
                background #fef3c7
                color #92400e
                stroke #f59e0b
                strokeWidth 4
            }

            element "Infrastructure System" {
                background #fff7ed
                color #9a3412
                stroke #f97316
            }

            element "Message System" {
                background #eff6ff
                color #1d4ed8
                stroke #3b82f6
            }

            element "Analytics System" {
                shape cylinder
                background #eef2ff
                color #3730a3
                stroke #6366f1
            }

            element "Search System" {
                background #fdf2f8
                color #9d174d
                stroke #ec4899
            }

            element "Observability System" {
                background #f1f5f9
                color #0f172a
                stroke #64748b
            }

            element "Tool System" {
                background #ecfccb
                color #3f6212
                stroke #84cc16
            }

            element "External System" {
                background #fff1f2
                color #991b1b
                stroke #dc2626
                strokeWidth 4
            }

            element "Boundary" {
                strokeWidth 5
            }

            relationship "Relationship" {
                thickness 3
            }
        }
    }

    configuration {
        scope landscape
    }
}
