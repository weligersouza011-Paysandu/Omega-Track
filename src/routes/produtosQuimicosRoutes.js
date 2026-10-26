// ============================================================================
// src/routes/produtosQuimicosRoutes.js — Rotas de Produtos Químicos (EcoGestão).
//
// Endpoints protegidos por autenticação administrativa (requerAdmin):
//   POST   /importar       -> Importação via planilha Excel/CSV (multipart, campo `arquivo`)
//   GET    /               -> Listagem com filtros (enquadramento, local, busca) e resumo estatístico
//   POST   /               -> Cadastro manual de produto químico
//   PUT    /:id            -> Atualização de produto químico e matriz de perigos
//   DELETE /:id            -> Exclusão de produto químico
// ============================================================================
import { Router } from 'express';
import multer from 'multer';
import {
  importarProdutosQuimicos,
  listarProdutosQuimicos,
  criarProdutoQuimico,
  atualizarProdutoQuimico,
  excluirProdutoQuimico,
  excluirProdutosQuimicosLote,
} from '../controllers/produtosQuimicosController.js';
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
        message: 'O limite para importacao de planilhas de produtos quimicos e 25 MB.',
      });
    }
    return res.status(400).json({
      error: 'Arquivo invalido',
      message: erro.message,
    });
  });
}

// Endpoints da API
router.get('/', requerAdmin, listarProdutosQuimicos);
router.post('/importar', requerAdmin, receberPlanilha, importarProdutosQuimicos);
router.post('/excluir-lote', requerAdmin, excluirProdutosQuimicosLote);
router.delete('/lote', requerAdmin, excluirProdutosQuimicosLote);
router.post('/', requerAdmin, criarProdutoQuimico);
router.put('/:id', requerAdmin, atualizarProdutoQuimico);
router.delete('/:id', requerAdmin, excluirProdutoQuimico);

export default router;
