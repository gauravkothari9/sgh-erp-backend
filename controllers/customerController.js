const path = require('path');
const prisma = require('../src/lib/prisma');
const generateFileNumber = require('../utils/generateFileNumber');
const { AppError } = require('../middleware/errorHandler');
const { uploadToGitHub } = require('../utils/localStorage');
const {
  successResponse,
  createdResponse,
  paginatedResponse,
  buildPagination,
} = require('../utils/apiResponse');

// Frontend uses 'Active' / 'Inactive'. Prisma stores 'ACTIVE' / 'INACTIVE'.
const FROM_FRONTEND_STATUS = { Active: 'ACTIVE', Inactive: 'INACTIVE' };
const TO_FRONTEND_STATUS = { ACTIVE: 'Active', INACTIVE: 'Inactive' };
const toDbStatus = (s) => FROM_FRONTEND_STATUS[s] || s;
const toFrontendStatus = (s) => TO_FRONTEND_STATUS[s] || s;

// Order status strings the frontend uses for "active order" detection.
const ACTIVE_ORDER_STATUSES = [
  'DRAFT', 'FINALIZED', 'PENDING', 'IN_PRODUCTION',
  'QC', 'POLISH', 'PACKAGING', 'READY_TO_SHIP', 'SHIPPED',
];

// Hide DB-internal enum casing from the wire so the frontend keeps reading
// what it always read.
const shape = (c) => {
  if (!c) return c;
  return {
    ...c,
    _id: c.id,
    status: toFrontendStatus(c.status),
  };
};

// ─── @GET /api/v1/customers ──────────────────────────────────────────────────
exports.getCustomers = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
    country,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const where = { isDeleted: false };
  if (status) where.status = toDbStatus(status);
  if (country) where.country = country;

  if (search) {
    where.OR = [
      { companyName: { contains: search, mode: 'insensitive' } },
      { fileNumber: { contains: search, mode: 'insensitive' } },
      { contactPersonName: { contains: search, mode: 'insensitive' } },
      { agent: { contains: search, mode: 'insensitive' } },
    ];
  }

  const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };
  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy,
      skip,
      take: parseInt(limit, 10),
    }),
    prisma.customer.count({ where }),
  ]);

  // Attach order counts in one round-trip.
  const ids = customers.map((c) => c.id);
  let stats = [];
  if (ids.length > 0) {
    stats = await prisma.order.groupBy({
      by: ['customerId'],
      where: { customerId: { in: ids }, orderStatus: { not: 'CANCELLED' } },
      _count: { _all: true },
      _sum: { finalAmount: true },
    });
  }
  const statsMap = Object.fromEntries(
    stats.map((s) => [
      s.customerId,
      { totalOrders: s._count._all, totalOrderValue: Number(s._sum.finalAmount || 0) },
    ])
  );

  const enriched = customers.map((c) => ({
    ...shape(c),
    totalOrders: statsMap[c.id]?.totalOrders || 0,
    totalOrderValue: statsMap[c.id]?.totalOrderValue || 0,
  }));

  paginatedResponse(
    res,
    enriched,
    buildPagination(total, page, limit),
    'Customers fetched successfully'
  );
};

// ─── @GET /api/v1/customers/:id ──────────────────────────────────────────────
exports.getCustomer = async (req, res) => {
  const id = Number(req.params.id);
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer || customer.isDeleted) throw new AppError('Customer not found', 404);

  const orders = await prisma.order.findMany({
    where: { customerId: id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      orderStatus: true,
      orderDate: true,
      finalAmount: true,
      currency: true,
      orderType: true,
      containerSize: true,
      fileNumber: true,
      items: true,
    },
  });

  const totalOrderValue = orders.reduce((sum, o) => sum + Number(o.finalAmount || 0), 0);
  const activeOrders = orders.filter((o) =>
    !['COMPLETED', 'CANCELLED'].includes(o.orderStatus)
  ).length;

  successResponse(res, {
    customer: shape(customer),
    orders: orders.map((o) => ({ ...o, _id: o.id })),
    stats: {
      totalOrders: orders.length,
      totalOrderValue,
      activeOrders,
    },
  });
};

// ─── @GET /api/v1/customers/file/:fileNumber ─────────────────────────────────
exports.getCustomerByFileNumber = async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { fileNumber: req.params.fileNumber },
  });
  if (!customer || customer.isDeleted) throw new AppError('Customer not found', 404);
  successResponse(res, { customer: shape(customer) });
};

// ─── @POST /api/v1/customers ────────────────────────────────────────────────
exports.createCustomer = async (req, res) => {
  let fileNumber = req.body.fileNumber?.trim();
  if (!fileNumber) {
    fileNumber = await generateFileNumber();
  } else {
    const existing = await prisma.customer.findUnique({ where: { fileNumber } });
    if (existing) {
      throw new AppError(
        `File number "${fileNumber}" already exists. Please use a different one.`,
        409
      );
    }
  }

  const { status, ...rest } = req.body;
  const data = {
    ...rest,
    fileNumber,
    status: status ? toDbStatus(status) : 'ACTIVE',
    createdById: req.user.id,
    customerSince: rest.customerSince ? new Date(rest.customerSince) : new Date(),
  };

  const customer = await prisma.customer.create({ data });
  createdResponse(res, { customer: shape(customer) }, 'Customer created successfully');
};

// ─── @PUT /api/v1/customers/:id ──────────────────────────────────────────────
exports.updateCustomer = async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) throw new AppError('Customer not found', 404);

  // fileNumber and createdBy are IMMUTABLE
  const {
    fileNumber: _ignoredFile,
    createdById: _ignoredCreator,
    createdBy: _ignoredCreator2,
    status,
    customerSince,
    ...rest
  } = req.body;

  const data = { ...rest };
  if (status) data.status = toDbStatus(status);
  if (customerSince) data.customerSince = new Date(customerSince);

  const customer = await prisma.customer.update({ where: { id }, data });
  successResponse(res, { customer: shape(customer) }, 'Customer updated successfully');
};

// ─── @PATCH /api/v1/customers/:id/status ────────────────────────────────────
exports.updateCustomerStatus = async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!['Active', 'Inactive'].includes(status)) {
    throw new AppError('Invalid status. Must be Active or Inactive.', 400);
  }

  const customer = await prisma.customer.update({
    where: { id },
    data: { status: toDbStatus(status) },
  }).catch(() => null);

  if (!customer) throw new AppError('Customer not found', 404);
  successResponse(res, { customer: shape(customer) }, `Customer status updated to ${status}`);
};

// ─── @DELETE /api/v1/customers/:id (Soft delete) ────────────────────────────
exports.deleteCustomer = async (req, res) => {
  const id = Number(req.params.id);
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer || customer.isDeleted) throw new AppError('Customer not found', 404);

  const activeOrders = await prisma.order.count({
    where: { customerId: id, orderStatus: { in: ACTIVE_ORDER_STATUSES } },
  });

  if (activeOrders > 0) {
    throw new AppError(
      `Cannot deactivate: customer has ${activeOrders} active order(s). Close or cancel them first.`,
      400
    );
  }

  await prisma.customer.update({
    where: { id },
    data: { isDeleted: true, status: 'INACTIVE' },
  });
  successResponse(res, null, 'Customer deactivated successfully');
};

// ─── @GET /api/v1/customers/stats/summary ───────────────────────────────────
exports.getCustomerStats = async (req, res) => {
  const where = { isDeleted: false };
  const [totalActive, totalInactive, byCountryRaw] = await Promise.all([
    prisma.customer.count({ where: { ...where, status: 'ACTIVE' } }),
    prisma.customer.count({ where: { ...where, status: 'INACTIVE' } }),
    prisma.customer.groupBy({
      by: ['country'],
      where: { ...where, status: 'ACTIVE' },
      _count: { _all: true },
      orderBy: { _count: { country: 'desc' } },
      take: 10,
    }),
  ]);

  const byCountry = byCountryRaw.map((b) => ({ _id: b.country, count: b._count._all }));

  successResponse(res, {
    totalActive,
    totalInactive,
    total: totalActive + totalInactive,
    byCountry,
  });
};

// ─── @POST /api/v1/customers/:id/photo ──────────────────────────────────────
exports.uploadPhoto = async (req, res) => {
  if (!req.file) throw new AppError('Please upload a file', 400);

  const id = Number(req.params.id);
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) throw new AppError('Customer not found', 404);

  const ext = path.extname(req.file.originalname);
  const filename = `customer-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const photoUrl = await uploadToGitHub(req.file.buffer, filename, 'customers');

  await prisma.customer.update({ where: { id }, data: { photo: photoUrl } });
  successResponse(res, { photo: photoUrl }, 'Photo uploaded successfully');
};
