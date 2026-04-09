-- Simulator run tracking — persists execution metadata so runs survive app restarts.
CREATE TABLE IF NOT EXISTS core.simulator_run (
    id              TEXT PRIMARY KEY,
    namespace       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'running',
    scenario_json   TEXT,
    started_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ,
    total_days      INT,
    completed_days  INT DEFAULT 0,
    error_message   TEXT,
    result_json     TEXT,
    progress_json   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
