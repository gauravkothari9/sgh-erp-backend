const express = require('express');
const router = express.Router();
const {
  listShowroomProducts,
  getShowroomProduct,
  createShowroomProduct,
  updateShowroomProduct,
  deleteShowroomProduct,
} = require('../controllers/showroomProductController');
const { protect, requirePermission } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

router.use(protect);

router.route('/')
  .get(requirePermission('showroom', 'read'), listShowroomProducts)
  .post(
    requirePermission('showroom', 'create'),
    uploadImage.array('photos', 10),
    createShowroomProduct
  );

router.route('/:id')
  .get(requirePermission('showroom', 'read'), getShowroomProduct)
  .put(
    requirePermission('showroom', 'update'),
    uploadImage.array('photos', 10),
    updateShowroomProduct
  )
  .delete(requirePermission('showroom', 'delete'), deleteShowroomProduct);

module.exports = router;
