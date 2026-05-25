// Frontend ↔ Prisma enum translation. Keeps the API contract stable so the
// existing React app doesn't have to learn UPPER_SNAKE_CASE.

const ORDER_STATUS_FROM_FRONTEND = {
  Draft: 'DRAFT',
  Finalized: 'FINALIZED',
  Pending: 'PENDING',
  'In Production': 'IN_PRODUCTION',
  QC: 'QC',
  Polish: 'POLISH',
  Packaging: 'PACKAGING',
  'Ready to Ship': 'READY_TO_SHIP',
  Shipped: 'SHIPPED',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
};

const ORDER_STATUS_TO_FRONTEND = Object.fromEntries(
  Object.entries(ORDER_STATUS_FROM_FRONTEND).map(([k, v]) => [v, k])
);

const ORDER_TYPE_FROM_FRONTEND = {
  'Sample Order': 'SAMPLE_ORDER',
  'Regular Order': 'REGULAR_ORDER',
  SAMPLE_ORDER: 'SAMPLE_ORDER',
  REGULAR_ORDER: 'REGULAR_ORDER',
};

const ORDER_TYPE_TO_FRONTEND = {
  SAMPLE_ORDER: 'Sample Order',
  REGULAR_ORDER: 'Regular Order',
};

const ROLE_FROM_FRONTEND = {
  Admin: 'ADMIN',
  Employee: 'EMPLOYEE',
  Manager: 'MANAGER',
  ShowroomStaff: 'SHOWROOM_STAFF',
};

const ROLE_TO_FRONTEND = Object.fromEntries(
  Object.entries(ROLE_FROM_FRONTEND).map(([k, v]) => [v, k])
);

const toDbOrderStatus = (s) => ORDER_STATUS_FROM_FRONTEND[s] || s;
const toFrontendOrderStatus = (s) => ORDER_STATUS_TO_FRONTEND[s] || s;
const toDbOrderType = (s) => ORDER_TYPE_FROM_FRONTEND[s] || s;
const toFrontendOrderType = (s) => ORDER_TYPE_TO_FRONTEND[s] || s;
const toDbRole = (r) => ROLE_FROM_FRONTEND[r] || r;
const toFrontendRole = (r) => ROLE_TO_FRONTEND[r] || r;

module.exports = {
  toDbOrderStatus,
  toFrontendOrderStatus,
  toDbOrderType,
  toFrontendOrderType,
  toDbRole,
  toFrontendRole,
  ORDER_STATUS_FROM_FRONTEND,
  ORDER_STATUS_TO_FRONTEND,
};
