-- ThidaAI Platform — PostgreSQL Schema

CREATE TABLE IF NOT EXISTS clients (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    email       VARCHAR(255),
    phone       VARCHAR(50),
    age         INTEGER,
    occupation  VARCHAR(255),
    income      NUMERIC(15, 2),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proposals (
    id            SERIAL PRIMARY KEY,
    client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    proposal_type VARCHAR(100) NOT NULL,
    content       TEXT,
    pdf_url       VARCHAR(500),
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mdrt_records (
    id             SERIAL PRIMARY KEY,
    client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    year           INTEGER NOT NULL,
    premium_amount NUMERIC(15, 2) DEFAULT 0,
    target_amount  NUMERIC(15, 2) NOT NULL,
    status         VARCHAR(50) DEFAULT 'in_progress',
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS planning_sessions (
    id          SERIAL PRIMARY KEY,
    client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    plan_type   VARCHAR(100) NOT NULL,
    input_data  JSONB,
    result_data JSONB,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
