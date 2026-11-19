import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requerSessao } from '../middleware/sessao.js';
import { contratosDisponiveis, ehMaster } from '../middleware/escopo.js';

// GET /api/contratos -> contratos que o usuario pode escolher no filtro dos
// dashboards. Nao ha cadastro de contratos: o contrato existe a partir do
// primeiro usuario/veiculo cadastrado com ele. Nao-Master recebe so o proprio.
const router = Router();

router.get('/', requerSessao, asyncHandler(async (req, res) => {
  res.json({
    data: await contratosDisponiveis(req),
    meu: req.atuante.contrato,
    master: ehMaster(req.atuante),
  });
}));

export default router;
