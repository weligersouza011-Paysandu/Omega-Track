// ============================================================================
// src/routes/residuosRoutes.js — Rotas de Gestão de Resíduos (EcoGestão).
//
// Endpoints protegidos por autenticação administrativa (requerAdmin):
//   POST   /importar       -> Importação via planilha Excel/CSV (multipart, campo `arquivo`)
//   GET    /               -> Listagem com filtros e resumo estatístico para Dashboard
//   GET    /meses          -> Lista de meses disponíveis para o filtro
//   POST   /               -> Criação manual de resíduo
//   PUT    /:id            -> Atualização de resíduo
//   DELETE /:id            -> Exclusão de resíduo
//   DELETE /mes/:mes_ano   -> Limpeza de todos os registros de um mês
// ============================================================================
import { Router } from 'express';
import multer from 'multer';
import {
  importarResiduos,
  listarResiduos,
  listarMesesResiduos,
  criarResiduo,
  atualizarResiduo,
  excluirResiduo,
  limparMesResiduos,
  excluirResiduosLote,
} from '../controllers/residuosController.js';
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
        message: 'O limite para importacao de planilhas de residuos e 25 MB.',
      });
    }
    return res.status(400).json({
      error: 'Arquivo invalido',
      message: erro.message,
    });
  });
}

// Endpoints da API
router.get('/', requerAdmin, listarResiduos);
router.get('/meses', requerAdmin, listarMesesResiduos);
router.post('/importar', requerAdmin, receberPlanilha, importarResiduos);
router.post('/excluir-lote', requerAdmin, excluirResiduosLote);
router.delete('/lote', requerAdmin, excluirResiduosLote);
router.post('/', requerAdmin, criarResiduo);
router.put('/:id', requerAdmin, atualizarResiduo);
router.delete('/mes/:mes_ano', requerAdmin, limparMesResiduos);
router.delete('/:id', requerAdmin, excluirResiduo);

export default router;
