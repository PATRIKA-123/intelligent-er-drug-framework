// Admin-specific endpoints: intentionally separate from the existing real/mock adapters.
import { request } from './client.js';
export const adminApi = {
  invitations: async () => (await request('/admin/management/invitations')).invitations || [],
  users: async () => (await request('/admin/management/users')).users || [],
  operations: () => request('/admin/management/operations'),
  summary: () => request('/admin/management/summary'),
  verifiedPurgePreview: (kind, ids) => request('/admin/test-cleanup/preview',{method:'POST',body:{kind,ids}}),
  verifiedPurgeExecute: (kind, ids, reason, digest, verification) => request('/admin/test-cleanup/execute',{method:'POST',body:{kind,ids,reason,digest,verification}}),
  cleanupPreview: (kind, ids) => request('/admin/cleanup/preview',{method:'POST',body:{kind,ids}}),
  cleanupExecute: (kind, ids, reason, confirmation) => request('/admin/cleanup/execute',{method:'POST',body:{kind,ids,reason,confirmation}}),
  resend: (row, email) => request(`${row.role === 'DOCTOR' ? '/doctors' : '/staff'}/${row.user_id}/resend-invitation`, {
    method: 'POST',body: email ? {email} : {},
  }),
  deletePending: (row) => request(`${row.role === 'DOCTOR' ? '/doctors' : '/staff'}/${row.user_id}`, {method:'DELETE'}),
  status: (id, is_active, reason) => request(`/admin/management/users/${id}/status`, {method:'PATCH',body:{is_active,reason}}),
  archive: (id, reason) => request(`/admin/management/users/${id}/archive`,{method:'POST',body:{reason,confirmation:'ARCHIVE ACCOUNT'}}),
  reset: (id) => request(`/admin/management/users/${id}/password-reset`, {method:'POST',body:{}}),
  deleteEmptyCase: (id, reason) => request(`/admin/management/cases/${id}`, {method:'DELETE',body:{reason}}),
  validateReset: (token) => request('/auth/password-reset/validate-reset', {method:'POST',body:{token}}),
  completeReset: (token,password) => request('/auth/password-reset/complete-reset', {method:'POST',body:{token,password}}),
};
