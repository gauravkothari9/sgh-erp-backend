const LocalCustomer = require('../models/LocalCustomer');
const LocalSale = require('../models/LocalSale');
const { AppError } = require('../middleware/errorHandler');
const { successResponse, createdResponse } = require('../utils/apiResponse');

const EDITABLE = [
  'name', 'phone', 'altPhone', 'email',
  'address', 'city',
  'companyName', 'gstin',
  'notes', 'tags',
];

const applyFields = (customer, body) => {
  EDITABLE.forEach((key) => {
    if (body[key] === undefined) return;
    customer[key] = key === 'tags'
      ? (Array.isArray(body.tags) ? body.tags : String(body.tags).split(',').map((t) => t.trim()).filter(Boolean))
      : body[key];
  });
};

// ─── @GET /api/v1/local/customers?search=&tag= ───────────────────────────────
exports.getCustomers = async (req, res) => {
  const { search, tag, limit = 50, page = 1 } = req.query;

  const filter = {};
  if (tag) filter.tags = tag;
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { companyName: rx }, { city: rx }];
  }

  const perPage = Math.min(parseInt(limit, 10) || 50, 200);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * perPage;

  const [customers, total] = await Promise.all([
    LocalCustomer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(perPage).lean(),
    LocalCustomer.countDocuments(filter),
  ]);

  successResponse(res, { customers, total, page: Number(page), limit: perPage });
};

// ─── @GET /api/v1/local/customers/:id ────────────────────────────────────────
// Includes the customer's purchase history (their local sales) and totals.
exports.getCustomer = async (req, res) => {
  const customer = await LocalCustomer.findById(req.params.id).lean();
  if (!customer) throw new AppError('Customer not found', 404);

  const sales = await LocalSale.find({ customer: customer._id })
    .sort({ saleDate: -1 })
    .lean();

  const stats = sales.reduce(
    (acc, s) => ({
      sales: acc.sales + 1,
      totalSpent: acc.totalSpent + (s.totalAmount || 0),
      balanceDue: acc.balanceDue + (s.balanceDue || 0),
    }),
    { sales: 0, totalSpent: 0, balanceDue: 0 }
  );

  successResponse(res, { customer, sales, stats });
};

// ─── @POST /api/v1/local/customers ───────────────────────────────────────────
exports.createCustomer = async (req, res) => {
  if (!req.body.name?.trim()) throw new AppError('Customer name is required.', 400);
  if (!req.body.phone?.trim()) throw new AppError('Phone is required.', 400);

  const customer = new LocalCustomer({ createdBy: req.user._id });
  applyFields(customer, req.body);
  await customer.save();

  createdResponse(res, { customer }, 'Customer added');
};

// ─── @PUT /api/v1/local/customers/:id ────────────────────────────────────────
exports.updateCustomer = async (req, res) => {
  const customer = await LocalCustomer.findById(req.params.id);
  if (!customer) throw new AppError('Customer not found', 404);

  applyFields(customer, req.body);
  if (!customer.name?.trim()) throw new AppError('Customer name is required.', 400);
  if (!customer.phone?.trim()) throw new AppError('Phone is required.', 400);

  await customer.save();
  successResponse(res, { customer }, 'Customer updated');
};

// ─── @DELETE /api/v1/local/customers/:id ─────────────────────────────────────
// A customer with sales against them is kept — deleting would orphan the bills.
exports.deleteCustomer = async (req, res) => {
  const customer = await LocalCustomer.findById(req.params.id);
  if (!customer) throw new AppError('Customer not found', 404);

  const sales = await LocalSale.countDocuments({ customer: customer._id });
  if (sales > 0) {
    throw new AppError(`Cannot delete — ${sales} local order(s) exist for this customer.`, 400);
  }

  await customer.deleteOne();
  successResponse(res, {}, 'Customer removed');
};
