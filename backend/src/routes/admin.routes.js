const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { detectarFolhaDestravada } = require('../middleware/folha');
const { auditoria, exportarBackup, importarBackupEnviado } = require('../controllers/adminController');
const usuarios = require('../controllers/usuariosController');

const router = express.Router();

// O backup do sistema atual passa de 2 MB, acima do limite global de 1 MB —
// esta rota (e só ela) aceita corpos grandes.
const corpoGrande = express.json({ limit: process.env.LIMITE_IMPORTACAO || '25mb' });

// Trilha de auditoria e backup completo são de supervisão: Master apenas.
// `detectarFolhaDestravada` não bloqueia nada aqui — só decide se a folha entra
// no backup exportado.
router.use(authenticate, authorize('master'), detectarFolhaDestravada);

router.get('/usuarios', asyncHandler(usuarios.listar));
router.post('/usuarios', asyncHandler(usuarios.criar));
router.put('/usuarios/:id', asyncHandler(usuarios.atualizar));
router.delete('/usuarios/:id', asyncHandler(usuarios.deletar));

router.get('/auditoria', asyncHandler(auditoria));
router.get('/backup', asyncHandler(exportarBackup));
router.post('/importar', corpoGrande, asyncHandler(importarBackupEnviado));

module.exports = router;
