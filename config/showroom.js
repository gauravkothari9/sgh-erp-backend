// Which zones each showroom branch has. Single source of truth for validation
// on the server; the frontend mirrors this in the route table.
const SHOWROOM_ZONES = {
  Kakani: ['A', 'B', 'C'],
  Jhalamand: ['A', 'B', 'C', 'D'],
};

const SHOWROOM_BRANCHES = Object.keys(SHOWROOM_ZONES);

// Suggested collections (product categories). Not an enum — a product may carry
// any collection name; these just populate the picker.
const SHOWROOM_COLLECTIONS = [
  'Chairs',
  'Almirahs',
  'Consoles',
  'Sideboards',
  'Bedsides',
  'Beds',
  'Tables',
  'Dining Sets',
  'Cabinets',
  'Chests',
  'Benches',
  'Mirrors',
  'Decor',
];

const isValidLocation = (branch, zone) =>
  !!SHOWROOM_ZONES[branch] && SHOWROOM_ZONES[branch].includes(String(zone || '').toUpperCase());

module.exports = { SHOWROOM_ZONES, SHOWROOM_BRANCHES, SHOWROOM_COLLECTIONS, isValidLocation };
