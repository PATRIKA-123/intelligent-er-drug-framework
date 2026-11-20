-- B14: No fabricated source version for historical mappings.
-- NULL version means legacy/unversioned. New rows must explicitly set a version.
ALTER TABLE public.canonical_medication_map ADD COLUMN IF NOT EXISTS mapping_version text;
ALTER TABLE public.medication_components ADD COLUMN IF NOT EXISTS mapping_version text;

-- Existing rows retain NULL; a source row's actual version must be provided on future imports.
-- NOT VALID avoids rewriting/invalidating historical data, but enforces on new rows/updates.
ALTER TABLE public.canonical_medication_map
  ADD CONSTRAINT b14_direct_mapped_name_required CHECK
  (upper(btrim(mapping_status)) <> 'MAPPED' OR nullif(btrim(canonical_name), '') IS NOT NULL) NOT VALID;
ALTER TABLE public.medication_components
  ADD CONSTRAINT b14_component_mapped_name_required CHECK
  (upper(btrim(mapping_status)) <> 'MAPPED' OR nullif(btrim(component_canonical_name), '') IS NOT NULL) NOT VALID;
CREATE INDEX IF NOT EXISTS b14_mapping_medication_version_idx
  ON public.canonical_medication_map(medication_id, mapping_version);
CREATE INDEX IF NOT EXISTS b14_component_medication_version_idx
  ON public.medication_components(medication_id, mapping_version);
