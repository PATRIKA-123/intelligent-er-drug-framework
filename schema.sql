-- ============================================================
-- Intelligent Emergency Room and Drug Framework
-- PostgreSQL Database Schema
-- ============================================================

-- ============================================================
-- 1. PATIENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    subject_id VARCHAR(50) UNIQUE NOT NULL,
    data_source VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 2. ED STAYS
-- ============================================================

CREATE TABLE IF NOT EXISTS ed_stays (
    id SERIAL PRIMARY KEY,
    stay_id VARCHAR(50) UNIQUE NOT NULL,
    subject_id VARCHAR(50) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ed_stays_patient
        FOREIGN KEY (subject_id)
        REFERENCES patients(subject_id)
        ON DELETE CASCADE
);


-- ============================================================
-- 3. CLINICAL OBSERVATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS observations (
    id SERIAL PRIMARY KEY,

    stay_id VARCHAR(50) NOT NULL,
    observation_time TIMESTAMP NOT NULL,

    temperature DECIMAL(5,2),
    heart_rate INTEGER,
    respiratory_rate INTEGER,
    spo2 DECIMAL(5,2),
    systolic_bp INTEGER,

    -- NEWS2-related fields
    consciousness VARCHAR(30),
    oxygen_support BOOLEAN,
    spo2_scale INTEGER,

    data_source VARCHAR(100),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_observations_stay
        FOREIGN KEY (stay_id)
        REFERENCES ed_stays(stay_id)
        ON DELETE CASCADE,

    -- Prevent the same observation from being imported again
    CONSTRAINT unique_stay_observation_time
        UNIQUE (stay_id, observation_time)
);


-- ============================================================
-- 4. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_observations_stay_id
    ON observations(stay_id);

CREATE INDEX IF NOT EXISTS idx_observations_observation_time
    ON observations(observation_time);

CREATE INDEX IF NOT EXISTS idx_ed_stays_subject_id
    ON ed_stays(subject_id);


-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT 'Schema setup complete!' AS status;