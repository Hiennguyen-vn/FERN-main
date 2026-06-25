workspace "FERN ERP Platform" "C4 System Context for the current FERN ERP/POS repository." {

    !identifiers hierarchical

    model {
        backOfficeAdmin = person "Back-office Admin" "Quản trị chuỗi: danh mục, giá, mua hàng, kho, nhân sự, lương, tài chính, báo cáo và cấu hình vận hành."
        outletStaff = person "Outlet / POS Staff" "Nhân viên cửa hàng vận hành ca bán, đơn hàng, thanh toán, đồng bộ thiết bị và xử lý tồn kho tại outlet."
        customer = person "Customer" "Khách hàng đặt món qua QR/table ordering và theo dõi trạng thái đơn."
        businessAnalyst = person "Business Analyst" "Người dùng khai thác báo cáo, dashboard và đặt câu hỏi dữ liệu bằng ngôn ngữ tự nhiên."
        systemOperator = person "System Operator" "Người vận hành theo dõi health, metrics, traces, sự cố hạ tầng và dữ liệu demo."
        developer = person "Developer / QA" "Kỹ sư phát triển, kiểm thử, chạy local services, smoke tests, migrations và simulator."

        fern = softwareSystem "FERN ERP Platform" "Nền tảng ERP/POS cho chuỗi đồ uống Highland-style. Bao gồm frontend, API gateway, domain services, sync service, AI query, reporting, shared PostgreSQL primary/replica, Kafka, Redis và observability." {
            tags "Core System"
        }

        webBrowser = softwareSystem "Web Browser" "Trình duyệt chạy React/Vite frontend cho admin, POS staff, analyst và customer ordering." {
            tags "Client System"
        }

        posEdgeDevice = softwareSystem "Outlet POS / Edge Device" "Thiết bị hoặc trình duyệt tại cửa hàng gửi sales sync, telemetry, order, payment và offline/online state." {
            tags "Client System"
        }

        localDataSimulator = softwareSystem "Local Data Simulator" "Công cụ local-only tạo dữ liệu vận hành demo bằng cơ chế preview/execute an toàn." {
            tags "Tool System"
        }

        postgresPrimary = softwareSystem "PostgreSQL Primary" "Shared fern database / core schema. Đây là primary write store dùng chung cho các service, không phải database-per-service." {
            tags "Database System"
        }

        postgresReplica = softwareSystem "PostgreSQL Read Replica" "Streaming standby database. Dùng cho reporting/read-only workload, đặc biệt report-service và AI query khi cấu hình replica." {
            tags "Database System"
        }

        pgbouncerPool = softwareSystem "PgBouncer / HAProxy Pool" "Connection pool và load-balanced entrypoint tùy chọn cho PostgreSQL primary." {
            tags "Infrastructure System"
        }

        redisSentinel = softwareSystem "Redis + Sentinel" "Cache/session/rate-limit/control-plane hot data, heartbeat registry, Redis replicas và Sentinel failover." {
            tags "Infrastructure System"
        }

        kafkaKraft = softwareSystem "Kafka KRaft" "Event backbone cho domain events, audit events, async integration và CDC pipeline." {
            tags "Message System"
        }

        kafkaConnect = softwareSystem "Kafka Connect / Debezium" "CDC pipeline đọc thay đổi từ PostgreSQL và đẩy sang Kafka/analytics targets." {
            tags "Message System"
        }

        objectStorage = softwareSystem "S3-compatible Object Storage" "MinIO local hoặc external S3-compatible bucket cho product images và finance documents." {
            tags "External System"
        }

        clickhouse = softwareSystem "ClickHouse Analytics Store" "Kho analytics/CDC phục vụ AI Query và truy vấn phân tích khi bật analytics/ai profile." {
            tags "Analytics System"
        }

        opensearch = softwareSystem "OpenSearch" "Search/RAG/runtime catalog index hỗ trợ AI Query và tra cứu knowledge/catalog." {
            tags "Search System"
        }

        openAiProvider = softwareSystem "OpenAI-compatible LLM Provider" "Model provider bên ngoài được ai-query-service gọi để xử lý natural-language BI/query." {
            tags "External System"
        }

        observabilityStack = softwareSystem "Observability Stack" "Prometheus, Grafana, Jaeger và exporters dùng để thu metrics, dashboard và traces." {
            tags "Observability System"
        }

        vaultProvider = softwareSystem "Vault / Secrets Provider" "Nguồn cấu hình bí mật tùy chọn cho database credentials và service configuration." {
            tags "External System"
        }

        backOfficeAdmin -> webBrowser "Uses admin workspace through"
        outletStaff -> webBrowser "Uses POS/admin screens through"
        outletStaff -> posEdgeDevice "Operates sales, sync and device workflows using"
        customer -> webBrowser "Places QR/table orders using"
        businessAnalyst -> webBrowser "Views reports and asks AI/business questions using"
        systemOperator -> observabilityStack "Monitors health, metrics and traces using"
        systemOperator -> localDataSimulator "Runs operational demo-data simulations using"
        developer -> localDataSimulator "Runs preview/execute data simulation using"
        developer -> fern "Runs services, migrations, smoke tests and local workflows against"

        webBrowser -> fern "Uses admin, POS, customer ordering, reporting and AI Query features"
        posEdgeDevice -> fern "Sends POS orders, sync payloads, telemetry and device requests"
        localDataSimulator -> fern "Exercises operational workflows through local services"
        localDataSimulator -> postgresPrimary "Seeds and cleans local demo data"

        fern -> postgresPrimary "Reads from and writes operational state to"
        fern -> pgbouncerPool "Optionally obtains pooled database connections through"
        pgbouncerPool -> postgresPrimary "Pools connections to"
        postgresPrimary -> postgresReplica "Streams WAL replication to"
        fern -> postgresReplica "Reads reporting and replica-safe data from"

        fern -> redisSentinel "Uses cache, session, rate-limit, heartbeat and configuration data in"
        fern -> kafkaKraft "Publishes and consumes domain, audit and integration events via"
        kafkaConnect -> postgresPrimary "Reads committed database changes from"
        kafkaConnect -> kafkaKraft "Publishes CDC events to"
        kafkaConnect -> clickhouse "Loads analytical projections into"

        fern -> objectStorage "Stores and retrieves product images and finance documents using"
        fern -> clickhouse "Queries analytical/CDC data from"
        fern -> opensearch "Searches knowledge, catalog and runtime indexes in"
        fern -> openAiProvider "Sends AI Query prompts and receives model responses from"
        fern -> observabilityStack "Exposes health, metrics and traces to"
        fern -> vaultProvider "Optionally loads secrets and dynamic database credentials from"

        observabilityStack -> postgresPrimary "Scrapes primary database metrics"
        observabilityStack -> postgresReplica "Scrapes replica metrics and lag"
        observabilityStack -> redisSentinel "Scrapes Redis metrics"
        observabilityStack -> kafkaKraft "Scrapes Kafka metrics"
    }

    views {
        systemContext fern "SystemContext" {
            include *
            autoLayout lr
        }

        styles {
            element "Element" {
                color #9a28f8
                stroke #9a28f8
                strokeWidth 7
                shape roundedbox
            }

            element "Person" {
                shape person
                background #ecfdf5
                color #166534
                stroke #16a34a
            }

            element "Core System" {
                background #e0f2fe
                color #075985
                stroke #0284c7
                strokeWidth 7
                shape roundedbox
            }

            element "Client System" {
                background #f0f9ff
                color #0369a1
                stroke #38bdf8
            }

            element "Database System" {
                shape cylinder
                background #fef3c7
                color #92400e
                stroke #f59e0b
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
            }

            element "Boundary" {
                strokeWidth 5
            }

            relationship "Relationship" {
                thickness 4
            }
        }
    }

    configuration {
        scope softwaresystem
    }
}
