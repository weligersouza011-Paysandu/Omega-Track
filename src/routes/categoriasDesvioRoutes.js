import { Router } from 'express';
import {
  listarCategoriasDesvio,
  criarCategoriaDesvio,
  atualizarCategoriaDesvio,
  excluirCategoriaDesvio,
} from '../controllers/categoriasDesvioController.js';
import { requerAdminAutenticado, requerGestaoTransporte } from '../middleware/sessao.js';

// Leitura aberta (o RDO lista as ativas); escrita restrita a quem gere a programacao.
const router = Router();
router.get('/', listarCategoriasDesvio);
router.post('/', requerAdminAutenticado, requerGestaoTransporte, criarCategoriaDesvio);
router.put('/:id', requerAdminAutenticado, requerGestaoTransporte, atualizarCategoriaDesvio);
router.delete('/:id', requerAdminAutenticado, requerGestaoTransporte, excluirCategoriaDesvio);

export default router;
