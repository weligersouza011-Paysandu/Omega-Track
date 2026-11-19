import { Router } from 'express';
import { requerAdmin, requerSessao } from '../middleware/sessao.js';
import { paramContrato } from '../middleware/escopo.js';
import prisma from '../config/database.js';
import { UUID } from '../utils/contrato.js';
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

// Documento herda o contrato do veiculo; de outro contrato => 404.
router.param('id', paramContrato(async (id) => (UUID.test(id)
  ? (await prisma.documentacaoVeiculo.findUnique({ where: { id }, select: { veiculo: { select: { contrato: true } } } }))?.veiculo?.contrato
  : null)));

router.get('/', requerSessao, listarDocumentacoes);
router.get('/farol', requerSessao, farolVencimentos);
router.get('/:id', requerSessao, buscarDocumentacao);
router.post('/', requerAdmin, criarDocumentacao);
router.put('/:id', requerAdmin, atualizarDocumentacao);
router.post('/:id/anexo', requerAdmin, anexarArquivo);
router.delete('/:id', requerAdmin, deletarDocumentacao);

export default router;
