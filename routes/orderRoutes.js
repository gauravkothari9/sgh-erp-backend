const express = require('express');
const router = express.Router();
const {
  getOrders,
  getOrder,
  createOrder,
  updateOrder,
  updateOrderStatus,
  cancelOrder,
  finalizeOrder,
  startProcessing,
  addComment,
  uploadOrderImages,
  uploadAttachment,
  getDashboardStats,
  exportOrders,
  deleteOrderMedia,
  deleteOrder,
  setPrimaryImage,
  uploadMedia,
  renameMediaToSku,
  getProductionConfig,
  getProductionBoard,
  getContainerProgress,
  getContainerFile,
  completeOrder,
  setItemProduction,
  setOrderFlags,
  setFileFlags,
  advanceItemStage,
} = require('../controllers/orderController');
const { protect, requirePermission } = require('../middleware/auth');
const { uploadDocument, uploadImage } = require('../middleware/upload');

// All order routes require authentication
router.use(protect);

// Dashboard stats
router.get('/stats/dashboard', requirePermission('orders', 'read'), getDashboardStats);

// Export (folded into read access)
router.get('/export', requirePermission('orders', 'read'), exportOrders);

// ─── Factory production tracking ─────────────────────────────────────────────
// Placed before the '/:id' routes; multi-segment paths won't collide with the
// single-segment '/:id' matcher, but keeping them here is clearest.
router.get('/production/config', requirePermission('production', 'read'), getProductionConfig);
router.get('/production/board', requirePermission('production', 'read'), getProductionBoard);
router.get('/container/progress', requirePermission('container', 'read'), getContainerProgress);
router.get('/container/file/:fileNumber', requirePermission('container', 'read'), getContainerFile);
router.patch('/:id/complete', requirePermission('orders', 'update'), completeOrder);
router.patch('/file/:fileNumber/flags', requirePermission('production', 'update'), setFileFlags);
router.patch('/:id/flags', requirePermission('production', 'update'), setOrderFlags);
router.patch('/:id/items/:itemId/production', requirePermission('production', 'update'), setItemProduction);
router.patch('/:id/items/:itemId/stage', requirePermission('production', 'update'), advanceItemStage);

// Standard CRUD
router.route('/')
  .get(requirePermission('orders', 'read'), getOrders)
  .post(requirePermission('orders', 'create'), createOrder);

router.route('/:id')
  .get(requirePermission('orders', 'read'), getOrder)
  .put(requirePermission('orders', 'update'), updateOrder)
  .delete(requirePermission('orders', 'delete'), deleteOrder);

// Finalize order (Draft → Finalized)
router.patch('/:id/finalize', requirePermission('orders', 'update'), finalizeOrder);

// Start processing (Finalized → Pending)
router.patch('/:id/start-processing', requirePermission('orders', 'update'), startProcessing);

// Status management — controller enforces forward-only for non-Admins
router.patch('/:id/status', requirePermission('orders', 'update'), updateOrderStatus);
router.patch('/:id/cancel', requirePermission('orders', 'update'), cancelOrder);

// Comments (with image upload)
router.post(
  '/:id/comments',
  requirePermission('orders', 'update'),
  uploadDocument.array('images', 10),
  addComment
);

// Generic media upload
router.post(
  '/upload-media',
  requirePermission('orders', 'create'),
  uploadImage.array('images', 20),
  uploadMedia
);

// Rename media files to a new SKU prefix (used when the user edits an
// order item's companySKU after images were already uploaded).
router.post(
  '/rename-media',
  requirePermission('orders', 'create'),
  renameMediaToSku
);

// Order images (multiple)
router.post(
  '/:id/images',
  requirePermission('orders', 'update'),
  uploadDocument.array('images', 20),
  uploadOrderImages
);

// Attachments (single file)
router.post(
  '/:id/attachments',
  requirePermission('orders', 'update'),
  uploadDocument.single('file'),
  uploadAttachment
);

// Media Management
router.delete('/:id/media', requirePermission('orders', 'update'), deleteOrderMedia);

// Primary Image selection
router.patch(
  '/:id/items/:itemId/primary-image',
  requirePermission('orders', 'update'),
  setPrimaryImage
);

module.exports = router;
