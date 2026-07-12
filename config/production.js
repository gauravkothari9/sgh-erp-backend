/**
 * Factory production workflow — single source of truth for item-level stage
 * tracking across the two units (Jhalamand + Kakani) plus outsourced work.
 *
 * Consumed by:
 *   • the Order item schema  (models/Order.js → item.production sub-document)
 *   • the order controller    (routing + stage validation + the board/views)
 *   • the frontend            (fetched once via GET /orders/production/config)
 *
 * Business rules encoded here (from the shop floor):
 *   • Containers dispatch from Kakani ONLY → every Polish/QC/Packing/Ready step
 *     happens at Kakani. Jhalamand items move to Kakani via an explicit
 *     Ready-for-Transit → In-Transit → Received handoff.
 *   • An item is ROUTED by three attributes: branch, category, sourcing.
 *
 * Routes → stage sequences:
 *   Jhalamand · Antique       Ready for Transit → In Transit → Received → Repairing → Polish → QC → Packing → Ready
 *   Jhalamand · Production    Made in Jhalamand → Ready for Transit → In Transit → Received → Polish → QC → Packing → Ready
 *   Kakani · Antique (in-house)   Repairing → Polish → QC → Packing → Ready
 *   Kakani · Production (in-house) Made in Kakani → Polish → QC → Packing → Ready
 *   Kakani · Outsourced       Sample Provided → Received → Polish → QC → Packing → Ready
 */

const BRANCHES = ['Jhalamand', 'Kakani'];
const CATEGORIES = ['Antique', 'Production'];   // an item's make type
const SOURCING = ['In-house', 'Outsourced', 'In Stock'];    // Kakani-only distinction

// Physical unit locations (currentLocation can also be the derived 'In Transit').
const LOCATIONS = ['Jhalamand', 'Kakani'];

// Legacy alias — older callers/tests referenced PRODUCTION_TYPES.
const PRODUCTION_TYPES = CATEGORIES;

// Makers, each tied to the unit they work in. Add a line to expose a new maker
// in the routing dropdown (frontend reads this via /orders/production/config).
const MAKERS = [
  { name: 'Indra',      location: 'Jhalamand' },
  { name: 'Ramesh ji',  location: 'Jhalamand' },
  { name: 'Virendra',   location: 'Jhalamand' },
  { name: 'Govind',     location: 'Kakani' },
  { name: 'Iron Khata', location: 'Kakani' },
];

// Canonical stage names — referenced everywhere, never typed as raw strings.
const STAGE = {
  MADE_JHALAMAND:    'Made in Jhalamand',
  READY_FOR_TRANSIT: 'Ready for Transit',
  IN_TRANSIT:        'In Transit',
  RECEIVED:          'Received',
  SAMPLE_PROVIDED:   'Sample Provided',
  IN_STOCK:          'In Stock',
  REPAIRING:         'Repairing',
  MADE_KAKANI:       'Made in Kakani',
  POLISH:            'Polish',
  QC:                'QC',
  PACKING:           'Packing',
  READY:             'Ready for Container',
};

// Ordered stage sequence per workflow path.
const PATHS = {
  jhalamand_antique:    [STAGE.READY_FOR_TRANSIT, STAGE.IN_TRANSIT, STAGE.RECEIVED, STAGE.REPAIRING, STAGE.POLISH, STAGE.QC, STAGE.PACKING, STAGE.READY],
  jhalamand_production: [STAGE.MADE_JHALAMAND, STAGE.READY_FOR_TRANSIT, STAGE.IN_TRANSIT, STAGE.RECEIVED, STAGE.POLISH, STAGE.QC, STAGE.PACKING, STAGE.READY],
  kakani_antique:       [STAGE.REPAIRING, STAGE.POLISH, STAGE.QC, STAGE.PACKING, STAGE.READY],
  kakani_production:    [STAGE.MADE_KAKANI, STAGE.POLISH, STAGE.QC, STAGE.PACKING, STAGE.READY],
  kakani_outsourced:    [STAGE.SAMPLE_PROVIDED, STAGE.RECEIVED, STAGE.POLISH, STAGE.QC, STAGE.PACKING, STAGE.READY],
  kakani_instock:       [STAGE.IN_STOCK, STAGE.QC, STAGE.PACKING, STAGE.READY],
};

// Physical location of an item while it sits in a given stage. Powers the
// "which unit is it at right now" filter used by the branch views.
const STAGE_LOCATION = {
  [STAGE.MADE_JHALAMAND]:    'Jhalamand',
  [STAGE.READY_FOR_TRANSIT]: 'Jhalamand',
  [STAGE.IN_TRANSIT]:        'In Transit',
  [STAGE.RECEIVED]:          'Kakani',
  [STAGE.SAMPLE_PROVIDED]:   'Kakani',   // outsourcing is managed from Kakani
  [STAGE.IN_STOCK]:          'Kakani',
  [STAGE.REPAIRING]:         'Kakani',
  [STAGE.MADE_KAKANI]:       'Kakani',
  [STAGE.POLISH]:            'Kakani',
  [STAGE.QC]:                'Kakani',
  [STAGE.PACKING]:           'Kakani',
  [STAGE.READY]:             'Kakani',
};

// Items routed but not yet started (or not routable yet) show here on the board.
const NEEDS_SETUP = 'Needs Setup';

// Unified left-to-right column order for the Kanban board. Roughly follows the
// flow: Jhalamand-side → transit → Kakani intake → Kakani finishing → Ready.
const BOARD_COLUMNS = [
  NEEDS_SETUP,
  STAGE.MADE_JHALAMAND,
  STAGE.READY_FOR_TRANSIT,
  STAGE.IN_TRANSIT,
  STAGE.RECEIVED,
  STAGE.SAMPLE_PROVIDED,
  STAGE.IN_STOCK,
  STAGE.REPAIRING,
  STAGE.MADE_KAKANI,
  STAGE.POLISH,
  STAGE.QC,
  STAGE.PACKING,
  STAGE.READY,
];

// ─── Path resolution ─────────────────────────────────────────────────────────
// Resolve the workflow-path key from an item's routing attributes. Accepts the
// new object form `{ branch, category, sourcing }`. Returns null when it can't
// be resolved yet (e.g. branch chosen but category/sourcing missing).
const resolvePathKey = ({ branch, category, sourcing } = {}) => {
  if (branch === 'Jhalamand') {
    if (category === 'Antique') return 'jhalamand_antique';
    if (category === 'Production') return 'jhalamand_production';
    return null;
  }
  if (branch === 'Kakani') {
    if (sourcing === 'Outsourced') return 'kakani_outsourced';
    if (sourcing === 'In Stock') return 'kakani_instock';
    if (category === 'Antique') return 'kakani_antique';
    if (category === 'Production') return 'kakani_production';
    return null;
  }
  return null;
};

// Map the legacy `(productionType, madeAt)` shape onto the new attributes so
// items routed before this change (and old callers) still resolve a path.
// Antiques default to in-house Kakani; Production keeps its unit.
const legacyToAttrs = (productionType, madeAt) => {
  if (productionType === 'Antique') {
    return { branch: madeAt || 'Kakani', category: 'Antique', sourcing: 'In-house' };
  }
  if (productionType === 'Production') {
    return { branch: madeAt || '', category: 'Production', sourcing: 'In-house' };
  }
  return {};
};

// getPath — supports BOTH the new object form and the legacy positional form:
//   getPath({ branch, category, sourcing })
//   getPath(productionType, madeAt)              // backward compatible
const getPath = (arg, madeAt) => {
  const attrs = typeof arg === 'object' && arg !== null
    ? arg
    : legacyToAttrs(arg, madeAt);
  const key = resolvePathKey(attrs);
  return key ? PATHS[key] : null;
};

// Map the legacy item.itemCondition enum to a default category so items created
// before this feature slot into the right path automatically.
const deriveType = (itemCondition) => {
  if (itemCondition === 'One of Kind') return 'Antique';
  if (itemCondition === 'Production') return 'Production';
  return '';
};

const isBranch = (b) => BRANCHES.includes(b);
const isCategory = (c) => CATEGORIES.includes(c);
const isSourcing = (s) => SOURCING.includes(s);
const isMaker = (name) => MAKERS.some((m) => m.name === name);
const makerLocation = (name) => (MAKERS.find((m) => m.name === name) || {}).location || '';

module.exports = {
  BRANCHES,
  CATEGORIES,
  SOURCING,
  LOCATIONS,
  PRODUCTION_TYPES,
  MAKERS,
  STAGE,
  PATHS,
  STAGE_LOCATION,
  BOARD_COLUMNS,
  NEEDS_SETUP,
  resolvePathKey,
  legacyToAttrs,
  getPath,
  deriveType,
  isBranch,
  isCategory,
  isSourcing,
  isMaker,
  makerLocation,
};
