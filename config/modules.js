/**
 * Canonical list of ERP modules and per-module permission actions.
 *
 * Every module the user-permission system knows about must live here — this
 * file is the single source of truth consumed by:
 *   • the User schema (to build the default permissions object)
 *   • the requirePermission middleware (to validate module/action pairs)
 *   • the frontend permission matrix UI (via the /auth/modules endpoint)
 *
 * Admin always has full access to everything regardless of what is stored
 * against their user document, so this list only governs Employee access.
 */

const MODULES = [
  // Office Department
  { key: 'dashboard',       label: 'Dashboard',         department: 'Office', parent: null },
  { key: 'customers',       label: 'Customers',         department: 'Office', parent: null },
  { key: 'orders',          label: 'Orders',            department: 'Office', parent: null },
  { key: 'buyerCatalogue',  label: 'Buyer Catalogue',   department: 'Office', parent: null },

  // Admin / System
  { key: 'users',           label: 'User Management',   department: 'Admin',  parent: null },
  { key: 'settings',        label: 'System Settings',   department: 'Admin',  parent: null },
];

const ACTIONS = ['create', 'read', 'update', 'delete'];

const MODULE_KEYS = MODULES.map((m) => m.key);

const buildEmptyPermissionsMap = () => {
  const map = {};
  for (const m of MODULE_KEYS) {
    map[m] = {};
    for (const a of ACTIONS) map[m][a] = false;
  }
  return map;
};

const isValidModule = (key) => MODULE_KEYS.includes(key);
const isValidAction = (action) => ACTIONS.includes(action);

const getDepartments = () => [...new Set(MODULES.map((m) => m.department))];
const getModulesByDepartment = (dept) =>
  MODULES.filter((m) => m.department === dept);

module.exports = {
  MODULES,
  MODULE_KEYS,
  ACTIONS,
  buildEmptyPermissionsMap,
  isValidModule,
  isValidAction,
  getDepartments,
  getModulesByDepartment,
};
