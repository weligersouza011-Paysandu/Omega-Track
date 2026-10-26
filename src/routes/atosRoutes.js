// ============================================================================
// src/routes/atosRoutes.js — Rotas de Atos Autorizativos (EcoGestão).
//
// Endpoints protegidos por autenticação administrativa (requerAdmin):
//   POST   /importar       -> Importação via planilha Excel/CSV (multipart, campo `arquivo`)
//   GET    /               -> Listagem com filtros (status, farol, busca) e resumo estatístico
//   POST   /               -> Criação manual de ato autorizativo
//   PUT    /:id            -> Atualização de ato autorizativo
//   DELETE /:id            -> Exclusão de ato autorizativo
// ============================================================================
import { Router } from 'express';
import multer from 'multer';
import {
  importarAtos,
  listarAtos,
  criarAto,
  atualizarAto,
  excluirAto,
} from '../controllers/atosController.js';
import { requerAdmin } from '../middleware/sessao.js';

const router = Router();

// Upload em memória: a planilha é lida e descartada, sem gravar em disco
const uploadPlanilha = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    const aceito = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    if (!aceito) {
      const erro = new Error('Apenas arquivos .xlsx, .xls ou .csv sao aceitos.');
      erro.statusCode = 400;
      return cb(erro);
    }
    return cb(null, true);
  },
});

function receberPlanilha(req, res, next) {
  uploadPlanilha.single('arquivo')(req, res, (erro) => {
    if (!erro) return next();
    if (erro instanceof multer.MulterError && erro.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'Arquivo muito grande',
        message: 'O limite para importacao de planilhas de atos autorizativos e 25 MB.',
      });
    }
    return res.status(400).json({
      error: 'Arquivo invalido',
      message: erro.message,
    });
  });
}

// Endpoints da API
router.get('/', requerAdmin, listarAtos);
router.post('/importar', requerAdmin, receberPlanilha, importarAtos);
router.post('/', requerAdmin, criarAto);
router.put('/:id', requerAdmin, atualizarAto);
router.delete('/:id', requerAdmin, excluirAto);

export default router;
