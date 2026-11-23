export const ROLE_LABEL = {DOCTOR:'Doctor',ER_STAFF:'ER staff',PARAMEDIC:'Paramedic',PATIENT:'Patient',ADMIN:'Administrator'};
export const when = (value) => value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : '—';
