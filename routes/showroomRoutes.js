const express = require('express');
const { protect } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');
const {
  listProducts,
  getCollections,
  getCollectionProducts,
  getProduct,
  createProduct,
  updateProduct,
  transferStock,
  consumeStock,
  deleteProduct,
} = require('../controllers/showroomController');

const router = express.Router();

// All showroom routes require a signed-in user; per-branch permission is
// enforced inside the controller against showroomKakani / showroomJhalamand.
router.use(protect);

router.get('/collections', getCollections);
router.get('/collections/products', getCollectionProducts);
router.get('/products', listProducts);
router.post('/products', uploadImage.single('image'), createProduct);
router.post('/products/consume', consumeStock);
router.get('/products/:id', getProduct);
router.put('/products/:id', uploadImage.single('image'), updateProduct);
router.patch('/products/:id/transfer', transferStock);
router.delete('/products/:id', deleteProduct);

module.exports = router;
