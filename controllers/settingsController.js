const Settings = require('../models/Settings');
const { successResponse } = require('../utils/apiResponse');

// ─── @GET /api/v1/settings ───────────────────────────────────────────────────
// Readable by any signed-in user — the company block prints on their bills.
exports.getSettings = async (req, res) => {
  const settings = await Settings.getSingleton();
  successResponse(res, { settings });
};

// ─── @PUT /api/v1/settings ───────────────────────────────────────────────────
// Requires `settings:update`. Sections are merged, so a partial body is fine.
exports.updateSettings = async (req, res) => {
  const settings = await Settings.getSingleton();
  const { company, local, notifications } = req.body;

  if (company) settings.company = { ...settings.company.toObject(), ...company };
  if (local) settings.local = { ...settings.local.toObject(), ...local };
  if (notifications) {
    settings.notifications = { ...settings.notifications.toObject(), ...notifications };
  }
  settings.updatedBy = req.user._id;

  await settings.save();
  successResponse(res, { settings }, 'Settings saved');
};
