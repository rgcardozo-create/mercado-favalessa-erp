const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { login, me } = require('../controllers/authController');

const router = express.Router();

router.post('/login', asyncHandler(login));
router.get('/me', authenticate, asyncHandler(me));

module.exports = router;
