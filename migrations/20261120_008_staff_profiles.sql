-- T1: display name for invited paramedics and ER staff.
-- Doctors keep using doctor_profiles. Safe to run more than once.
-- Run this on Neon BEFORE deploying the code that reads staff_profiles.
CREATE TABLE IF NOT EXISTS public.staff_profiles (
    user_id integer PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
    full_name character varying(150) NOT NULL
);
