// ============================================================================
// src/routes/aguaRoutes.js — Rotas de Consumo de Água Potável (EcoGestão).
//
// Endpoints protegidos por autenticação administrativa (requerAdmin):
//   POST   /importar       -> Importação via planilha Excel/CSV (multipart, campo `arquivo`)
//   GET    /               -> Listagem com filtros e resumo estatístico para Dashboard
//   GET    /meses          -> Lista de meses disponíveis para o filtro
//   POST   /               -> Criação manual de registro de consumo
//   PUT    /:id            -> Atualização de registro
//   DELETE /:id            -> Exclusão de registro
//   DELETE /mes/:ano_mes   -> Limpeza de todos os registros de um mês
// ============================================================================
import { Router } from 'express';
import multer from 'multer';
import {
  importarConsumoAgua,
  listarConsumoAgua,
  listarMesesAgua,
  criarConsumoAgua,
  atualizarConsumoAgua,
  excluirConsumoAgua,
  limparMesAgua,
} from '../controllers/aguaController.js';
import { requerAdmin } from '../middleware/sessao.js';

const router = Router();

// Upload em memória: a planilha é lida diretamente e descartada, sem salvar no disco
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
        message: 'O limite para importacao de planilhas de consumo de agua e 25 MB.',
      });
    }
    return res.status(400).json({
      error: 'Arquivo invalido',
      message: erro.message,
    });
  });
}

// Endpoints da API
router.get('/', requerAdmin, listarConsumoAgua);
router.get('/meses', requerAdmin, listarMesesAgua);
router.post('/importar', requerAdmin, receberPlanilha, importarConsumoAgua);
router.post('/', requerAdmin, criarConsumoAgua);
router.put('/:id', requerAdmin, atualizarConsumoAgua);
router.delete('/mes/:ano_mes', requerAdmin, limparMesAgua);
router.delete('/:id', requerAdmin, excluirConsumoAgua);

export default router;
