import { Router } from 'express';
import {
  listarDocumentacoes,
  farolVencimentos,
  buscarDocumentacao,
  criarDocumentacao,
  atualizarDocumentacao,
  deletarDocumentacao,
} from '../controllers/documentacaoController.js';

const router = Router();

router.get('/', listarDocumentacoes);
router.get('/farol', farolVencimentos);
router.get('/:id', buscarDocumentacao);
router.post('/', criarDocumentacao);
router.put('/:id', atualizarDocumentacao);
router.delete('/:id', deletarDocumentacao);

export default router;
