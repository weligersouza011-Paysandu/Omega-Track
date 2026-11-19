import { Router } from 'express';
import { requerAdmin, requerSessao } from '../middleware/sessao.js';
import {
  listarDocumentacoes,
  farolVencimentos,
  buscarDocumentacao,
  criarDocumentacao,
  atualizarDocumentacao,
  deletarDocumentacao,
  anexarArquivo,
} from '../controllers/documentacaoController.js';

const router = Router();

router.get('/', requerSessao, listarDocumentacoes);
router.get('/farol', requerSessao, farolVencimentos);
router.get('/:id', requerSessao, buscarDocumentacao);
router.post('/', requerAdmin, criarDocumentacao);
router.put('/:id', requerAdmin, atualizarDocumentacao);
router.post('/:id/anexo', requerAdmin, anexarArquivo);
router.delete('/:id', requerAdmin, deletarDocumentacao);

export default router;
