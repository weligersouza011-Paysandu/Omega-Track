import { Router } from 'express';
import { bloquearMeioAmbiente } from '../middleware/setor.js';
import {
  listarCategoriasDesvio,
  criarCategoriaDesvio,
  atualizarCategoriaDesvio,
  excluirCategoriaDesvio,
} from '../controllers/categoriasDesvioController.js';
import { requerAdminAutenticado, requerGestaoTransporte, requerSessao } from '../middleware/sessao.js';

// Leitura aberta (o RDO lista as ativas). Criar: qualquer usuario logado
// ("+ Adicionar nova categoria..." na Parte Diaria, feita pelo operador).
// Renomear, ativar/desativar e excluir: so quem gere a programacao.
const router = Router();
router.use(bloquearMeioAmbiente); // modulo de transporte
router.get('/', requerSessao, listarCategoriasDesvio);
router.post('/', requerSessao, criarCategoriaDesvio);
router.put('/:id', requerAdminAutenticado, requerGestaoTransporte, atualizarCategoriaDesvio);
router.delete('/:id', requerAdminAutenticado, requerGestaoTransporte, excluirCategoriaDesvio);

export default router;
