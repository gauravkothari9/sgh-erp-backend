const express = require('express');
const { protect, requirePermission } = require('../middleware/auth');
const {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require('../controllers/localCustomerController');
const {
  getSales,
  getSale,
  createSale,
  updatePayment,
  returnItems,
  deleteSale,
} = require('../controllers/localSaleController');

const router = express.Router();

router.use(protect);

// ── Local customers ─────────────────────────────────────────────────────────
router.route('/customers')
  .get(requirePermission('localCustomers', 'read'), getCustomers)
  .post(requirePermission('localCustomers', 'create'), createCustomer);

router.route('/customers/:id')
  .get(requirePermission('localCustomers', 'read'), getCustomer)
  .put(requirePermission('localCustomers', 'update'), updateCustomer)
  .delete(requirePermission('localCustomers', 'delete'), deleteCustomer);

// ── Local orders (walk-in showroom sales) ───────────────────────────────────
router.route('/sales')
  .get(requirePermission('localSales', 'read'), getSales)
  .post(requirePermission('localSales', 'create'), createSale);

router.route('/sales/:id')
  .get(requirePermission('localSales', 'read'), getSale)
  .delete(requirePermission('localSales', 'delete'), deleteSale);

router.patch('/sales/:id/payment', requirePermission('localSales', 'update'), updatePayment);
router.post('/sales/:id/return', requirePermission('localSales', 'update'), returnItems);

module.exports = router;
