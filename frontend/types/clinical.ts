export type ClinicalStatus = "critical" | "warning" | "info" | "low" | "unknown";
export type NavKey = "Dashboard" | "Patient Management" | "PRE-ER" | "ER Clinical" | "Medication & Drug Safety" | "POST-ER" | "User Management";
export type Patient = { id: string; name: string; age: number | null; mrn: string; status: ClinicalStatus; location: string; lastUpdated: string };
export type VitalPoint = { time: string; value: number };
