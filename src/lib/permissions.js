// src/lib/permissions.js
// Client-side affordance checks. Server-side RLS + API handlers enforce the same rules.

export const ROLES = {
  admin: 'admin',
  hiring_manager: 'hiring_manager',
  hiring_team: 'hiring_team',
  interviewer: 'interviewer',
};

export function hasRole(profile, ...allowed) {
  if (!profile?.role) return false;
  return allowed.includes(profile.role);
}

export function isAdmin(profile) {
  return profile?.role === ROLES.admin;
}

export function canCreateProject(profile) {
  return hasRole(profile, ROLES.admin, ROLES.hiring_manager);
}

export function canEditRole(profile, projectMembership) {
  if (isAdmin(profile)) return true;
  if (!projectMembership) return false;
  return ['manager', 'member'].includes(projectMembership.role_in_project);
}

export function canAdvanceStage(profile, projectMembership) {
  if (isAdmin(profile)) return true;
  if (!projectMembership) return false;
  return ['manager', 'member'].includes(projectMembership.role_in_project);
}

export function canSubmitFeedback(profile, isAssigned) {
  if (isAdmin(profile)) return true;
  return Boolean(isAssigned);
}
