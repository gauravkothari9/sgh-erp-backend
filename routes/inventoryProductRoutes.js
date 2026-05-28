const express = require('express');
const router = express.Router();
const {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  sellProduct,
  sampleProduct,
  transferProduct,
  receiveProduct,
  returnSampleProduct,
  listAllOnFloor,
  getGlobalLedger,
  bulkActionProducts,
} = require('../controllers/inventoryProductController');
const { protect, requirePermission } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

router.use(protect);

router.route('/')
  .get(requirePermission('showroom', 'read'), listProducts)
  .post(
    requirePermission('showroom', 'create'),
    uploadImage.array('photos', 10),
    createProduct
  );

router.route('/ledger')
  .get(requirePermission('showroom', 'read'), getGlobalLedger);

router.route('/all-on-floor')
  .get(requirePermission('showroom', 'read'), listAllOnFloor);

router.route('/bulk-action')
  .post(requirePermission('showroom', 'update'), bulkActionProducts);

router.route('/:id')
  .get(requirePermission('showroom', 'read'), getProduct)
  .put(
    requirePermission('showroom', 'update'),
    uploadImage.array('photos', 10),
    updateProduct
  )
  .delete(requirePermission('showroom', 'delete'), deleteProduct);

router.route('/:id/sell')
  .post(requirePermission('showroom', 'update'), sellProduct);

router.route('/:id/sample')
  .post(requirePermission('showroom', 'update'), sampleProduct);

router.route('/:id/return-sample')
  .post(requirePermission('showroom', 'update'), returnSampleProduct);

router.route('/:id/transfer')
  .post(requirePermission('showroom', 'update'), transferProduct);

router.route('/:id/receive')
  .post(requirePermission('showroom', 'update'), receiveProduct);

module.exports = router;
