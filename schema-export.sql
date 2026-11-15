--
-- PostgreSQL database dump
--

\restrict orHeV5Anw4b8rxI9qbRXsKbIxwImJlanrnubTVWIHReUVOYosEYD25Rh2fzKgPV

-- Dumped from database version 18.7 (a21afb5)
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: allergies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.allergies (
    allergy_id integer NOT NULL,
    patient_id integer NOT NULL,
    allergen character varying(255) NOT NULL,
    reaction character varying(255),
    severity character varying(30),
    status character varying(30) DEFAULT 'ACTIVE'::character varying,
    source character varying(100),
    recorded_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: allergies_allergy_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.allergies_allergy_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: allergies_allergy_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.allergies_allergy_id_seq OWNED BY public.allergies.allergy_id;


--
-- Name: ambulance_transports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ambulance_transports (
    transport_id integer NOT NULL,
    case_id integer NOT NULL,
    ambulance_id character varying(100),
    transport_type character varying(50),
    pickup_location text,
    destination_hospital character varying(255),
    departure_time timestamp without time zone,
    arrival_time timestamp without time zone,
    transport_status character varying(50),
    source character varying(100) DEFAULT 'APPLICATION'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ambulance_transports_transport_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ambulance_transports_transport_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ambulance_transports_transport_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ambulance_transports_transport_id_seq OWNED BY public.ambulance_transports.transport_id;


--
-- Name: canonical_medication_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canonical_medication_map (
    mapping_id integer NOT NULL,
    medication_id integer NOT NULL,
    source_name character varying(255) NOT NULL,
    canonical_name character varying(255),
    mapping_status character varying(30) DEFAULT 'PENDING'::character varying,
    mapping_method character varying(50),
    confidence character varying(20),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: canonical_medication_map_mapping_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.canonical_medication_map_mapping_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: canonical_medication_map_mapping_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.canonical_medication_map_mapping_id_seq OWNED BY public.canonical_medication_map.mapping_id;


--
-- Name: clinical_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clinical_alerts (
    alert_id integer NOT NULL,
    patient_id integer NOT NULL,
    stay_id bigint,
    alert_type character varying(50) NOT NULL,
    alert_source character varying(50) NOT NULL,
    medication_id_a integer,
    medication_id_b integer,
    safety_result_id integer,
    severity character varying(30),
    priority character varying(30),
    alert_title character varying(255) NOT NULL,
    alert_message text,
    status character varying(30) DEFAULT 'ACTIVE'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    engine_run_id uuid,
    engine_version text
);


--
-- Name: clinical_alerts_alert_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clinical_alerts_alert_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clinical_alerts_alert_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clinical_alerts_alert_id_seq OWNED BY public.clinical_alerts.alert_id;


--
-- Name: decision_support_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_support_results (
    decision_id integer NOT NULL,
    patient_id integer NOT NULL,
    stay_id bigint NOT NULL,
    news2_score numeric,
    news2_category character varying(50),
    trend_classification character varying(50),
    drug_alert_count integer DEFAULT 0,
    major_interaction_count integer DEFAULT 0,
    moderate_interaction_count integer DEFAULT 0,
    overall_risk character varying(30),
    decision_priority character varying(30),
    decision_summary text,
    evidence_source character varying(100) DEFAULT 'NEWS2 + VITAL_TREND + DDInter'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    engine_run_id uuid,
    engine_version text
);


--
-- Name: decision_support_results_decision_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.decision_support_results_decision_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: decision_support_results_decision_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.decision_support_results_decision_id_seq OWNED BY public.decision_support_results.decision_id;


--
-- Name: diagnoses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diagnoses (
    diagnosis_id integer NOT NULL,
    subject_id bigint NOT NULL,
    stay_id bigint NOT NULL,
    seq_num smallint NOT NULL,
    icd_code character varying(10) NOT NULL,
    icd_version smallint NOT NULL,
    icd_title text NOT NULL
);


--
-- Name: diagnoses_diagnosis_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diagnoses_diagnosis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diagnoses_diagnosis_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diagnoses_diagnosis_id_seq OWNED BY public.diagnoses.diagnosis_id;


--
-- Name: discharges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discharges (
    discharge_id integer NOT NULL,
    patient_id integer NOT NULL,
    stay_id bigint,
    discharge_time timestamp without time zone,
    discharge_status character varying(50),
    discharge_diagnosis text,
    discharge_instructions text,
    disposition character varying(100),
    prescribed_followup boolean DEFAULT false,
    source character varying(100) DEFAULT 'APPLICATION'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: discharges_discharge_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.discharges_discharge_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: discharges_discharge_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.discharges_discharge_id_seq OWNED BY public.discharges.discharge_id;


--
-- Name: doctor_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_invitations (
    invitation_id bigint NOT NULL,
    user_id integer NOT NULL,
    token_hash character(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_by integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE ONLY public.doctor_invitations ALTER COLUMN invitation_id SET (pg_attver=82217624);
ALTER TABLE ONLY public.doctor_invitations ALTER COLUMN user_id SET (pg_attver=82217624);
ALTER TABLE ONLY public.doctor_invitations ALTER COLUMN token_hash SET (pg_attver=82217624);
ALTER TABLE ONLY public.doctor_invitations ALTER COLUMN expires_at SET (pg_attver=82217624);
ALTER TABLE ONLY public.doctor_invitations ALTER COLUMN accepted_at SET (pg_attver=82217624);
ALTER TABLE ONLY public.doctor_invitations ALTER COLUMN revoked_at SET (pg_attver=82217624);
ALTER TABLE ONLY public.doctor_invitations ALTER COLUMN created_by SET (pg_attver=82217624);
ALTER TABLE ONLY public.doctor_invitations ALTER COLUMN created_at SET (pg_attver=82217624);


--
-- Name: doctor_invitations_invitation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.doctor_invitations ALTER COLUMN invitation_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.doctor_invitations_invitation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: doctor_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_profiles (
    user_id integer NOT NULL,
    full_name character varying(150) NOT NULL,
    qualification character varying(150),
    specialization character varying(150),
    registration_number character varying(100)
);
ALTER TABLE ONLY public.doctor_profiles ALTER COLUMN user_id SET (pg_attver=82071248);
ALTER TABLE ONLY public.doctor_profiles ALTER COLUMN full_name SET (pg_attver=82071248);
ALTER TABLE ONLY public.doctor_profiles ALTER COLUMN qualification SET (pg_attver=82071248);
ALTER TABLE ONLY public.doctor_profiles ALTER COLUMN specialization SET (pg_attver=82071248);
ALTER TABLE ONLY public.doctor_profiles ALTER COLUMN registration_number SET (pg_attver=82071248);


--
-- Name: drug_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drug_interactions (
    interaction_id integer NOT NULL,
    ddinter_id_a character varying(50) NOT NULL,
    drug_a character varying(255) NOT NULL,
    ddinter_id_b character varying(50) NOT NULL,
    drug_b character varying(255) NOT NULL,
    interaction_level character varying(30) NOT NULL,
    source character varying(50) DEFAULT 'DDInter_2.0'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: drug_interactions_interaction_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.drug_interactions_interaction_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: drug_interactions_interaction_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.drug_interactions_interaction_id_seq OWNED BY public.drug_interactions.interaction_id;


--
-- Name: drug_safety_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drug_safety_results (
    safety_result_id integer NOT NULL,
    patient_id integer NOT NULL,
    stay_id bigint,
    medication_id_a integer NOT NULL,
    medication_id_b integer NOT NULL,
    component_a character varying(255) NOT NULL,
    component_b character varying(255) NOT NULL,
    interaction_id integer,
    interaction_level character varying(30),
    result_status character varying(30) DEFAULT 'INTERACTION_FOUND'::character varying,
    source character varying(50) DEFAULT 'DDInter_2.0'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    engine_run_id uuid,
    engine_version text
);


--
-- Name: drug_safety_results_safety_result_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.drug_safety_results_safety_result_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: drug_safety_results_safety_result_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.drug_safety_results_safety_result_id_seq OWNED BY public.drug_safety_results.safety_result_id;


--
-- Name: ed_stays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ed_stays (
    stay_id bigint NOT NULL,
    subject_id bigint NOT NULL,
    intime timestamp without time zone,
    outtime timestamp without time zone,
    gender text,
    disposition text,
    chiefcomplaint text,
    acuity integer
);


--
-- Name: emergency_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_cases (
    case_id integer NOT NULL,
    patient_id integer,
    stay_id bigint,
    temporary_case_code character varying(30) NOT NULL,
    case_status character varying(20) DEFAULT 'PRE_ER'::character varying NOT NULL,
    source character varying(30) DEFAULT 'APPLICATION'::character varying NOT NULL,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT emergency_cases_case_status_check CHECK (((case_status)::text = ANY (ARRAY[('PRE_ER'::character varying)::text, ('ARRIVED_ER'::character varying)::text, ('ACTIVE_ER'::character varying)::text, ('CLOSED'::character varying)::text])))
);


--
-- Name: emergency_cases_case_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_cases_case_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emergency_cases_case_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_cases_case_id_seq OWNED BY public.emergency_cases.case_id;


--
-- Name: fhir_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fhir_resources (
    resource_id text NOT NULL,
    resource_type text NOT NULL,
    resource_json jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: follow_ups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.follow_ups (
    follow_up_id integer NOT NULL,
    patient_id integer NOT NULL,
    stay_id bigint,
    follow_up_date timestamp without time zone,
    follow_up_type character varying(100),
    department character varying(100),
    provider_name character varying(255),
    status character varying(50) DEFAULT 'PLANNED'::character varying,
    notes text,
    source character varying(100) DEFAULT 'APPLICATION'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: follow_ups_follow_up_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.follow_ups_follow_up_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: follow_ups_follow_up_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.follow_ups_follow_up_id_seq OWNED BY public.follow_ups.follow_up_id;


--
-- Name: medical_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medical_history (
    history_id integer NOT NULL,
    patient_id integer NOT NULL,
    condition character varying(255) NOT NULL,
    description text,
    diagnosis_date date,
    status character varying(50),
    source character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: medical_history_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.medical_history_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: medical_history_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.medical_history_history_id_seq OWNED BY public.medical_history.history_id;


--
-- Name: medication_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medication_components (
    component_id integer NOT NULL,
    medication_id integer NOT NULL,
    component_name character varying(255) NOT NULL,
    component_canonical_name character varying(255),
    mapping_status character varying(30) DEFAULT 'PENDING'::character varying,
    confidence character varying(20),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: medication_components_component_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.medication_components_component_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: medication_components_component_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.medication_components_component_id_seq OWNED BY public.medication_components.component_id;


--
-- Name: medications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medications (
    medication_id integer NOT NULL,
    patient_id integer NOT NULL,
    stay_id bigint,
    medication_name character varying(255) NOT NULL,
    normalized_name character varying(255) NOT NULL,
    charttime timestamp without time zone NOT NULL,
    gsn bigint,
    ndc bigint,
    etccode character varying(50),
    etcdescription text,
    source character varying(100) DEFAULT 'MIMIC_IV_ED_MEDRECON'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    medication_type character varying(30) DEFAULT 'DRUG'::character varying
);


--
-- Name: medications_medication_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.medications_medication_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: medications_medication_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.medications_medication_id_seq OWNED BY public.medications.medication_id;


--
-- Name: news2_context; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news2_context (
    context_id integer NOT NULL,
    observation_id integer NOT NULL,
    consciousness character varying(10) NOT NULL,
    oxygen_support boolean NOT NULL,
    spo2_scale smallint NOT NULL,
    data_source character varying(50) DEFAULT 'synthetic_test'::character varying NOT NULL,
    scenario_name character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT news2_context_consciousness_check CHECK (((consciousness)::text = ANY (ARRAY[('Alert'::character varying)::text, ('C'::character varying)::text, ('V'::character varying)::text, ('P'::character varying)::text, ('U'::character varying)::text]))),
    CONSTRAINT news2_context_spo2_scale_check CHECK ((spo2_scale = ANY (ARRAY[1, 2])))
);


--
-- Name: news2_context_context_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news2_context_context_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news2_context_context_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news2_context_context_id_seq OWNED BY public.news2_context.context_id;


--
-- Name: news2_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news2_results (
    news2_result_id integer NOT NULL,
    observation_id integer NOT NULL,
    context_id integer NOT NULL,
    respiratory_score smallint NOT NULL,
    spo2_score smallint NOT NULL,
    oxygen_score smallint NOT NULL,
    systolic_bp_score smallint NOT NULL,
    heart_rate_score smallint NOT NULL,
    temperature_score smallint NOT NULL,
    consciousness_score smallint NOT NULL,
    total_news2_score smallint NOT NULL,
    risk_level character varying(30) NOT NULL,
    calculated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: news2_results_news2_result_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news2_results_news2_result_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news2_results_news2_result_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news2_results_news2_result_id_seq OWNED BY public.news2_results.news2_result_id;


--
-- Name: news2_results_real; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news2_results_real (
    observation_id integer,
    stay_id bigint,
    observation_time timestamp without time zone,
    respiratory_score integer,
    spo2_score integer,
    oxygen_score integer,
    systolic_bp_score integer,
    heart_rate_score integer,
    temperature_score integer,
    consciousness_score integer,
    total_news2_score integer,
    risk_level text
);


--
-- Name: observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.observations (
    observation_id integer NOT NULL,
    stay_id bigint NOT NULL,
    observation_time timestamp without time zone NOT NULL,
    temperature numeric(5,2) NOT NULL,
    heart_rate numeric(5,2) NOT NULL,
    respiratory_rate numeric(5,2) NOT NULL,
    spo2 numeric(5,2) NOT NULL,
    systolic_bp numeric(5,2) NOT NULL,
    data_source character varying(50) NOT NULL,
    consciousness character varying(10),
    oxygen_support boolean,
    spo2_scale smallint,
    consciousness_assumed boolean,
    oxygen_support_assumed boolean
);


--
-- Name: observations_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.observations_clean AS
 SELECT DISTINCT ON (stay_id, observation_time) observation_id,
    stay_id,
    observation_time,
    temperature,
    heart_rate,
    respiratory_rate,
    spo2,
    systolic_bp,
    data_source,
    consciousness,
    oxygen_support,
    spo2_scale,
        CASE
            WHEN (temperature > (50)::numeric) THEN round((((temperature - (32)::numeric) * 5.0) / 9.0), 1)
            ELSE temperature
        END AS temperature_celsius
   FROM public.observations
  ORDER BY stay_id, observation_time, observation_id;


--
-- Name: observations_observation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.observations_observation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: observations_observation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.observations_observation_id_seq OWNED BY public.observations.observation_id;


--
-- Name: patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patients (
    subject_id bigint NOT NULL,
    data_source character varying(50) NOT NULL,
    patient_id integer NOT NULL
);


--
-- Name: patients_patient_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patients_patient_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patients_patient_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patients_patient_id_seq OWNED BY public.patients.patient_id;


--
-- Name: pre_er_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_er_assessments (
    assessment_id integer NOT NULL,
    case_id integer NOT NULL,
    assessment_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    chief_complaint text,
    consciousness_status character varying(50),
    breathing_status character varying(50),
    circulation_status character varying(50),
    pain_score integer,
    initial_severity character varying(30),
    notes text,
    source character varying(100) DEFAULT 'APPLICATION'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    symptoms text,
    heart_rate numeric,
    respiratory_rate numeric,
    systolic_bp numeric,
    spo2 numeric,
    temperature numeric,
    oxygen_support boolean,
    allergy_status character varying(30) DEFAULT 'UNKNOWN'::character varying,
    current_medications jsonb DEFAULT '[]'::jsonb,
    recorded_by integer
);


--
-- Name: pre_er_assessments_assessment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pre_er_assessments_assessment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pre_er_assessments_assessment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pre_er_assessments_assessment_id_seq OWNED BY public.pre_er_assessments.assessment_id;


--
-- Name: pre_er_vitals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_er_vitals (
    vital_id integer NOT NULL,
    case_id integer NOT NULL,
    recorded_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    heart_rate numeric,
    systolic_bp numeric,
    diastolic_bp numeric,
    respiratory_rate numeric,
    spo2 numeric,
    temperature numeric,
    oxygen_support character varying(100),
    consciousness_level character varying(50),
    source character varying(100) DEFAULT 'APPLICATION'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: pre_er_vitals_vital_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pre_er_vitals_vital_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pre_er_vitals_vital_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pre_er_vitals_vital_id_seq OWNED BY public.pre_er_vitals.vital_id;


--
-- Name: prescriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prescriptions (
    prescription_id integer NOT NULL,
    patient_id integer NOT NULL,
    stay_id bigint,
    medication_name character varying(255) NOT NULL,
    dosage character varying(100),
    frequency character varying(100),
    route character varying(100),
    duration character varying(100),
    prescribed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    prescribed_by integer,
    instructions text,
    source character varying(100) DEFAULT 'APPLICATION'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: prescriptions_prescription_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prescriptions_prescription_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prescriptions_prescription_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prescriptions_prescription_id_seq OWNED BY public.prescriptions.prescription_id;


--
-- Name: staging_ddinter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staging_ddinter (
    ddinter_id_a character varying(50) NOT NULL,
    drug_a character varying(255) NOT NULL,
    ddinter_id_b character varying(50) NOT NULL,
    drug_b character varying(255) NOT NULL,
    interaction_level character varying(30) NOT NULL,
    source_file character varying(100),
    imported_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: staging_diagnosis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staging_diagnosis (
    subject_id bigint,
    stay_id bigint,
    seq_num smallint,
    icd_code character varying(10),
    icd_version smallint,
    icd_title text
);


--
-- Name: staging_medrecon; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staging_medrecon (
    subject_id bigint,
    stay_id bigint,
    charttime timestamp without time zone,
    name character varying(255),
    gsn bigint,
    ndc bigint,
    etc_rn integer,
    etccode character varying(50),
    etcdescription text
);


--
-- Name: stay_doctor_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stay_doctor_assignments (
    assignment_id bigint NOT NULL,
    stay_id bigint NOT NULL,
    doctor_user_id integer NOT NULL,
    assigned_by integer NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_assignment_status CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'COMPLETED'::character varying, 'CANCELLED'::character varying])::text[])))
);
ALTER TABLE ONLY public.stay_doctor_assignments ALTER COLUMN assignment_id SET (pg_attver=82102576);
ALTER TABLE ONLY public.stay_doctor_assignments ALTER COLUMN stay_id SET (pg_attver=82102576);
ALTER TABLE ONLY public.stay_doctor_assignments ALTER COLUMN doctor_user_id SET (pg_attver=82102576);
ALTER TABLE ONLY public.stay_doctor_assignments ALTER COLUMN assigned_by SET (pg_attver=82102576);
ALTER TABLE ONLY public.stay_doctor_assignments ALTER COLUMN status SET (pg_attver=82102576);
ALTER TABLE ONLY public.stay_doctor_assignments ALTER COLUMN notes SET (pg_attver=82102576);
ALTER TABLE ONLY public.stay_doctor_assignments ALTER COLUMN created_at SET (pg_attver=82102576);


--
-- Name: stay_doctor_assignments_assignment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.stay_doctor_assignments ALTER COLUMN assignment_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.stay_doctor_assignments_assignment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: trend_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trend_results (
    trend_result_id integer NOT NULL,
    stay_id bigint NOT NULL,
    observation_time timestamp without time zone NOT NULL,
    minutes_since_prev numeric,
    delta_spo2 numeric,
    delta_heart_rate numeric,
    delta_systolic_bp numeric,
    delta_respiratory_rate numeric,
    spo2_rate_per_hour numeric,
    hr_rate_per_hour numeric,
    sbp_rate_per_hour numeric,
    rr_rate_per_hour numeric,
    trend_classification text NOT NULL,
    calculated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: trend_results_trend_result_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trend_results_trend_result_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trend_results_trend_result_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trend_results_trend_result_id_seq OWNED BY public.trend_results.trend_result_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(150),
    password_hash text NOT NULL,
    role character varying(20) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    patient_id integer,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['PARAMEDIC'::character varying, 'ER_STAFF'::character varying, 'PATIENT'::character varying, 'ADMIN'::character varying, 'DOCTOR'::character varying])::text[])))
);
ALTER TABLE ONLY public.users ALTER COLUMN patient_id SET (pg_attver=84363320);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: allergies allergy_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergies ALTER COLUMN allergy_id SET DEFAULT nextval('public.allergies_allergy_id_seq'::regclass);


--
-- Name: ambulance_transports transport_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ambulance_transports ALTER COLUMN transport_id SET DEFAULT nextval('public.ambulance_transports_transport_id_seq'::regclass);


--
-- Name: canonical_medication_map mapping_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_medication_map ALTER COLUMN mapping_id SET DEFAULT nextval('public.canonical_medication_map_mapping_id_seq'::regclass);


--
-- Name: clinical_alerts alert_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_alerts ALTER COLUMN alert_id SET DEFAULT nextval('public.clinical_alerts_alert_id_seq'::regclass);


--
-- Name: decision_support_results decision_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_support_results ALTER COLUMN decision_id SET DEFAULT nextval('public.decision_support_results_decision_id_seq'::regclass);


--
-- Name: diagnoses diagnosis_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnoses ALTER COLUMN diagnosis_id SET DEFAULT nextval('public.diagnoses_diagnosis_id_seq'::regclass);


--
-- Name: discharges discharge_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discharges ALTER COLUMN discharge_id SET DEFAULT nextval('public.discharges_discharge_id_seq'::regclass);


--
-- Name: drug_interactions interaction_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_interactions ALTER COLUMN interaction_id SET DEFAULT nextval('public.drug_interactions_interaction_id_seq'::regclass);


--
-- Name: drug_safety_results safety_result_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_safety_results ALTER COLUMN safety_result_id SET DEFAULT nextval('public.drug_safety_results_safety_result_id_seq'::regclass);


--
-- Name: emergency_cases case_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_cases ALTER COLUMN case_id SET DEFAULT nextval('public.emergency_cases_case_id_seq'::regclass);


--
-- Name: follow_ups follow_up_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups ALTER COLUMN follow_up_id SET DEFAULT nextval('public.follow_ups_follow_up_id_seq'::regclass);


--
-- Name: medical_history history_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_history ALTER COLUMN history_id SET DEFAULT nextval('public.medical_history_history_id_seq'::regclass);


--
-- Name: medication_components component_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_components ALTER COLUMN component_id SET DEFAULT nextval('public.medication_components_component_id_seq'::regclass);


--
-- Name: medications medication_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medications ALTER COLUMN medication_id SET DEFAULT nextval('public.medications_medication_id_seq'::regclass);


--
-- Name: news2_context context_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news2_context ALTER COLUMN context_id SET DEFAULT nextval('public.news2_context_context_id_seq'::regclass);


--
-- Name: news2_results news2_result_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news2_results ALTER COLUMN news2_result_id SET DEFAULT nextval('public.news2_results_news2_result_id_seq'::regclass);


--
-- Name: observations observation_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations ALTER COLUMN observation_id SET DEFAULT nextval('public.observations_observation_id_seq'::regclass);


--
-- Name: patients patient_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients ALTER COLUMN patient_id SET DEFAULT nextval('public.patients_patient_id_seq'::regclass);


--
-- Name: pre_er_assessments assessment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_er_assessments ALTER COLUMN assessment_id SET DEFAULT nextval('public.pre_er_assessments_assessment_id_seq'::regclass);


--
-- Name: pre_er_vitals vital_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_er_vitals ALTER COLUMN vital_id SET DEFAULT nextval('public.pre_er_vitals_vital_id_seq'::regclass);


--
-- Name: prescriptions prescription_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions ALTER COLUMN prescription_id SET DEFAULT nextval('public.prescriptions_prescription_id_seq'::regclass);


--
-- Name: trend_results trend_result_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trend_results ALTER COLUMN trend_result_id SET DEFAULT nextval('public.trend_results_trend_result_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: allergies allergies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergies
    ADD CONSTRAINT allergies_pkey PRIMARY KEY (allergy_id);


--
-- Name: ambulance_transports ambulance_transports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ambulance_transports
    ADD CONSTRAINT ambulance_transports_pkey PRIMARY KEY (transport_id);


--
-- Name: canonical_medication_map canonical_medication_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_medication_map
    ADD CONSTRAINT canonical_medication_map_pkey PRIMARY KEY (mapping_id);


--
-- Name: clinical_alerts clinical_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_alerts
    ADD CONSTRAINT clinical_alerts_pkey PRIMARY KEY (alert_id);


--
-- Name: decision_support_results decision_support_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_support_results
    ADD CONSTRAINT decision_support_results_pkey PRIMARY KEY (decision_id);


--
-- Name: diagnoses diagnoses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnoses
    ADD CONSTRAINT diagnoses_pkey PRIMARY KEY (diagnosis_id);


--
-- Name: diagnoses diagnoses_stay_id_seq_num_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnoses
    ADD CONSTRAINT diagnoses_stay_id_seq_num_key UNIQUE (stay_id, seq_num);


--
-- Name: discharges discharges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discharges
    ADD CONSTRAINT discharges_pkey PRIMARY KEY (discharge_id);


--
-- Name: doctor_invitations doctor_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_invitations
    ADD CONSTRAINT doctor_invitations_pkey PRIMARY KEY (invitation_id);


--
-- Name: doctor_invitations doctor_invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_invitations
    ADD CONSTRAINT doctor_invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: doctor_profiles doctor_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_profiles
    ADD CONSTRAINT doctor_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: doctor_profiles doctor_profiles_registration_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_profiles
    ADD CONSTRAINT doctor_profiles_registration_number_key UNIQUE (registration_number);


--
-- Name: drug_interactions drug_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_interactions
    ADD CONSTRAINT drug_interactions_pkey PRIMARY KEY (interaction_id);


--
-- Name: drug_interactions drug_interactions_unique_pair; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_interactions
    ADD CONSTRAINT drug_interactions_unique_pair UNIQUE (ddinter_id_a, ddinter_id_b);


--
-- Name: drug_safety_results drug_safety_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_safety_results
    ADD CONSTRAINT drug_safety_results_pkey PRIMARY KEY (safety_result_id);


--
-- Name: ed_stays ed_stays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ed_stays
    ADD CONSTRAINT ed_stays_pkey PRIMARY KEY (stay_id);


--
-- Name: emergency_cases emergency_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_cases
    ADD CONSTRAINT emergency_cases_pkey PRIMARY KEY (case_id);


--
-- Name: emergency_cases emergency_cases_stay_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_cases
    ADD CONSTRAINT emergency_cases_stay_id_key UNIQUE (stay_id);


--
-- Name: emergency_cases emergency_cases_temporary_case_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_cases
    ADD CONSTRAINT emergency_cases_temporary_case_code_key UNIQUE (temporary_case_code);


--
-- Name: fhir_resources fhir_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fhir_resources
    ADD CONSTRAINT fhir_resources_pkey PRIMARY KEY (resource_id);


--
-- Name: follow_ups follow_ups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups
    ADD CONSTRAINT follow_ups_pkey PRIMARY KEY (follow_up_id);


--
-- Name: medical_history medical_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_history
    ADD CONSTRAINT medical_history_pkey PRIMARY KEY (history_id);


--
-- Name: medication_components medication_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_components
    ADD CONSTRAINT medication_components_pkey PRIMARY KEY (component_id);


--
-- Name: medications medications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medications
    ADD CONSTRAINT medications_pkey PRIMARY KEY (medication_id);


--
-- Name: news2_context news2_context_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news2_context
    ADD CONSTRAINT news2_context_pkey PRIMARY KEY (context_id);


--
-- Name: news2_results news2_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news2_results
    ADD CONSTRAINT news2_results_pkey PRIMARY KEY (news2_result_id);


--
-- Name: observations observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_pkey PRIMARY KEY (observation_id);


--
-- Name: patients patients_patient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_patient_id_key UNIQUE (patient_id);


--
-- Name: patients patients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (subject_id);


--
-- Name: pre_er_assessments pre_er_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_er_assessments
    ADD CONSTRAINT pre_er_assessments_pkey PRIMARY KEY (assessment_id);


--
-- Name: pre_er_vitals pre_er_vitals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_er_vitals
    ADD CONSTRAINT pre_er_vitals_pkey PRIMARY KEY (vital_id);


--
-- Name: prescriptions prescriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_pkey PRIMARY KEY (prescription_id);


--
-- Name: stay_doctor_assignments stay_doctor_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stay_doctor_assignments
    ADD CONSTRAINT stay_doctor_assignments_pkey PRIMARY KEY (assignment_id);


--
-- Name: trend_results trend_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trend_results
    ADD CONSTRAINT trend_results_pkey PRIMARY KEY (trend_result_id);


--
-- Name: observations unique_stay_observation_time; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT unique_stay_observation_time UNIQUE (stay_id, observation_time);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_drug_interactions_drug_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drug_interactions_drug_a ON public.drug_interactions USING btree (lower(TRIM(BOTH FROM drug_a)));


--
-- Name: idx_drug_interactions_drug_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drug_interactions_drug_b ON public.drug_interactions USING btree (lower(TRIM(BOTH FROM drug_b)));


--
-- Name: idx_drug_safety_results_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drug_safety_results_pair ON public.drug_safety_results USING btree (patient_id, medication_id_a, medication_id_b);


--
-- Name: idx_emergency_cases_patient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emergency_cases_patient_id ON public.emergency_cases USING btree (patient_id);


--
-- Name: idx_emergency_cases_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emergency_cases_status ON public.emergency_cases USING btree (case_status);


--
-- Name: idx_medication_components_canonical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medication_components_canonical ON public.medication_components USING btree (lower(TRIM(BOTH FROM component_canonical_name)));


--
-- Name: idx_medication_components_medication; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medication_components_medication ON public.medication_components USING btree (medication_id);


--
-- Name: idx_medications_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medications_patient ON public.medications USING btree (patient_id);


--
-- Name: idx_medications_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medications_type ON public.medications USING btree (medication_type);


--
-- Name: idx_users_patient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_patient_id ON public.users USING btree (patient_id);


--
-- Name: one_active_doctor_per_stay; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_active_doctor_per_stay ON public.stay_doctor_assignments USING btree (stay_id) WHERE ((status)::text = 'ACTIVE'::text);


--
-- Name: one_pending_invitation_per_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_pending_invitation_per_doctor ON public.doctor_invitations USING btree (user_id) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: allergies allergies_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergies
    ADD CONSTRAINT allergies_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- Name: ambulance_transports ambulance_transports_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ambulance_transports
    ADD CONSTRAINT ambulance_transports_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.emergency_cases(case_id);


--
-- Name: canonical_medication_map canonical_medication_map_medication_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_medication_map
    ADD CONSTRAINT canonical_medication_map_medication_fkey FOREIGN KEY (medication_id) REFERENCES public.medications(medication_id);


--
-- Name: clinical_alerts clinical_alerts_medication_id_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_alerts
    ADD CONSTRAINT clinical_alerts_medication_id_a_fkey FOREIGN KEY (medication_id_a) REFERENCES public.medications(medication_id);


--
-- Name: clinical_alerts clinical_alerts_medication_id_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_alerts
    ADD CONSTRAINT clinical_alerts_medication_id_b_fkey FOREIGN KEY (medication_id_b) REFERENCES public.medications(medication_id);


--
-- Name: clinical_alerts clinical_alerts_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_alerts
    ADD CONSTRAINT clinical_alerts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- Name: clinical_alerts clinical_alerts_safety_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_alerts
    ADD CONSTRAINT clinical_alerts_safety_result_id_fkey FOREIGN KEY (safety_result_id) REFERENCES public.drug_safety_results(safety_result_id) ON DELETE CASCADE;


--
-- Name: clinical_alerts clinical_alerts_stay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_alerts
    ADD CONSTRAINT clinical_alerts_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES public.ed_stays(stay_id);


--
-- Name: decision_support_results decision_support_results_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_support_results
    ADD CONSTRAINT decision_support_results_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- Name: decision_support_results decision_support_results_stay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_support_results
    ADD CONSTRAINT decision_support_results_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES public.ed_stays(stay_id);


--
-- Name: diagnoses diagnoses_stay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnoses
    ADD CONSTRAINT diagnoses_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES public.ed_stays(stay_id);


--
-- Name: discharges discharges_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discharges
    ADD CONSTRAINT discharges_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- Name: discharges discharges_stay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discharges
    ADD CONSTRAINT discharges_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES public.ed_stays(stay_id);


--
-- Name: drug_safety_results drug_safety_interaction_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_safety_results
    ADD CONSTRAINT drug_safety_interaction_fkey FOREIGN KEY (interaction_id) REFERENCES public.drug_interactions(interaction_id);


--
-- Name: drug_safety_results drug_safety_med_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_safety_results
    ADD CONSTRAINT drug_safety_med_a_fkey FOREIGN KEY (medication_id_a) REFERENCES public.medications(medication_id);


--
-- Name: drug_safety_results drug_safety_med_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_safety_results
    ADD CONSTRAINT drug_safety_med_b_fkey FOREIGN KEY (medication_id_b) REFERENCES public.medications(medication_id);


--
-- Name: drug_safety_results drug_safety_patient_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_safety_results
    ADD CONSTRAINT drug_safety_patient_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- Name: ed_stays ed_stays_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ed_stays
    ADD CONSTRAINT ed_stays_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.patients(subject_id);


--
-- Name: emergency_cases emergency_cases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_cases
    ADD CONSTRAINT emergency_cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: emergency_cases emergency_cases_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_cases
    ADD CONSTRAINT emergency_cases_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- Name: emergency_cases emergency_cases_stay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_cases
    ADD CONSTRAINT emergency_cases_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES public.ed_stays(stay_id);


--
-- Name: stay_doctor_assignments fk_assignment_admin; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stay_doctor_assignments
    ADD CONSTRAINT fk_assignment_admin FOREIGN KEY (assigned_by) REFERENCES public.users(user_id);


--
-- Name: stay_doctor_assignments fk_assignment_doctor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stay_doctor_assignments
    ADD CONSTRAINT fk_assignment_doctor FOREIGN KEY (doctor_user_id) REFERENCES public.doctor_profiles(user_id);


--
-- Name: stay_doctor_assignments fk_assignment_stay; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stay_doctor_assignments
    ADD CONSTRAINT fk_assignment_stay FOREIGN KEY (stay_id) REFERENCES public.ed_stays(stay_id);


--
-- Name: doctor_profiles fk_doctor_profiles_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_profiles
    ADD CONSTRAINT fk_doctor_profiles_user FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: doctor_invitations fk_invitation_admin; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_invitations
    ADD CONSTRAINT fk_invitation_admin FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: doctor_invitations fk_invitation_doctor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_invitations
    ADD CONSTRAINT fk_invitation_doctor FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: follow_ups follow_ups_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups
    ADD CONSTRAINT follow_ups_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- Name: follow_ups follow_ups_stay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups
    ADD CONSTRAINT follow_ups_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES public.ed_stays(stay_id);


--
-- Name: medical_history medical_history_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_history
    ADD CONSTRAINT medical_history_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- Name: medication_components medication_components_medication_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_components
    ADD CONSTRAINT medication_components_medication_fkey FOREIGN KEY (medication_id) REFERENCES public.medications(medication_id);


--
-- Name: medications medications_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medications
    ADD CONSTRAINT medications_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- Name: medications medications_stay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medications
    ADD CONSTRAINT medications_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES public.ed_stays(stay_id);


--
-- Name: news2_context news2_context_observation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news2_context
    ADD CONSTRAINT news2_context_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.observations(observation_id);


--
-- Name: news2_results news2_results_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news2_results
    ADD CONSTRAINT news2_results_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.news2_context(context_id);


--
-- Name: news2_results news2_results_observation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news2_results
    ADD CONSTRAINT news2_results_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.observations(observation_id);


--
-- Name: observations observations_stay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES public.ed_stays(stay_id);


--
-- Name: pre_er_assessments pre_er_assessments_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_er_assessments
    ADD CONSTRAINT pre_er_assessments_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.emergency_cases(case_id);


--
-- Name: pre_er_vitals pre_er_vitals_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_er_vitals
    ADD CONSTRAINT pre_er_vitals_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.emergency_cases(case_id);


--
-- Name: prescriptions prescriptions_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- Name: prescriptions prescriptions_prescribed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_prescribed_by_fkey FOREIGN KEY (prescribed_by) REFERENCES public.users(user_id);


--
-- Name: prescriptions prescriptions_stay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES public.ed_stays(stay_id);


--
-- Name: users users_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id);


--
-- PostgreSQL database dump complete
--

\unrestrict orHeV5Anw4b8rxI9qbRXsKbIxwImJlanrnubTVWIHReUVOYosEYD25Rh2fzKgPV

