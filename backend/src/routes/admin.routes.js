const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { detectarFolhaDestravada } = require('../middleware/folha');
const { auditoria, exportarBackup } = require('../controllers/adminController');

const router = express.Router();

// Trilha de auditoria e backup completo são de supervisão: Master apenas.
// `detectarFolhaDestravada` não bloqueia nada aqui — só decide se a folha entra
// no backup exportado.
router.use(authenticate, authorize('master'), detectarFolhaDestravada);

router.get('/auditoria', asyncHandler(auditoria));
router.get('/backup', asyncHandler(exportarBackup));

module.exports = router;
