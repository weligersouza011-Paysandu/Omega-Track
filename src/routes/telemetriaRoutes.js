// ============================================================================
// src/routes/telemetriaRoutes.js — Telemetria & Fadiga (PGS-007245 Rev. 03).
//
// Endpoints protegidos por autenticação administrativa (requerAdmin):
//   GET    /               -> Eventos com filtros (busca, horas, evento, severidade, status, tag, inicio, fim)
//   GET    /semanas        -> Semanas do ano (ISO) com registro; padrão = as duas mais recentes
//   (todas as listagens aceitam ?semanas=AAAA-SS,AAAA-SS)
//   GET    /resumo         -> KPIs, Top 5 de veículos, alerta de risco do dia e % de fadiga sem parada
//   GET    /fadiga         -> Ocorrências de fadiga detectada com farol, recorrência e medida (Anexo I)
//   PATCH  /fadiga/validacao -> { ids, decisao: CONFIRMADA|DESCARTADA|AUTOMATICA, motivo? }
//   GET    /motoristas/historico?motorista= -> Histórico do condutor (eventos, fadiga, planos)
//   GET    /matriz-fadiga  -> Matriz de Eventos de Fadiga do Anexo I e critérios
//   GET    /velocidade     -> Ocorrências de excesso de velocidade com farol, faixa e medida (Anexo I)
//   PATCH  /velocidade/validacao -> { ids, decisao: CONFIRMADA|DESCARTADA|AUTOMATICA, motivo? }
//   GET    /matriz-velocidade -> Matriz de Velocidade do Anexo I e critérios
//   GET/POST /planos | PATCH/DELETE /planos/:id -> Planos de ação (tipo FADIGA ou VELOCIDADE)
//   POST   /importar       -> Planilha da plataforma (multipart, campo `arquivo`; confirmar=true grava)
//   POST   /               -> Lançamento manual de evento
//   PATCH  /:id/tratativa  -> { status_tratativa, medida_aplicada?, observacao? }
//   POST   /excluir-lote | DELETE /lote -> { ids }
//   DELETE /:id            -> Exclusão de evento
// ============================================================================
import { Router } from 'express';
import multer from 'multer';
import {
  listarEventosTelemetria,
  resumoTelemetria,
  importarTelemetria,
  criarEventoTelemetria,
  registrarTratativaTelemetria,
  excluirEventoTelemetria,
  excluirEventosTelemetriaLote,
  listarSemanasTelemetria,
} from '../controllers/telemetriaController.js';
import {
  analiseFadiga,
  validarFadiga,
  historicoMotorista,
  matrizFadiga,
  listarPlanos,
  criarPlano,
  atualizarPlano,
  excluirPlano,
} from '../controllers/telemetriaFadigaController.js';
import { analiseVelocidade, validarVelocidade, matrizVelocidade } from '../controllers/telemetriaVelocidadeController.js';
import { requerAdmin } from '../middleware/sessao.js';

const router = Router();

// Upload em memória: a planilha é lida e descartada, sem gravar em disco.
// A exportação da plataforma traz todas as posições do período (dezenas de milhares de linhas).
const uploadPlanilha = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 }, // 30 MB
  fileFilter: (_req, file, cb) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.originalname || '')) {
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
        message: 'O limite para importacao de planilhas de telemetria e 30 MB.',
      });
    }
    return res.status(400).json({ error: 'Arquivo invalido', message: erro.message });
  });
}

router.get('/', requerAdmin, listarEventosTelemetria);
router.get('/resumo', requerAdmin, resumoTelemetria);
router.get('/semanas', requerAdmin, listarSemanasTelemetria);

// Fadiga detectada (farol, ocorrências, mapa) e planos de ação do Anexo I.
router.get('/fadiga', requerAdmin, analiseFadiga);
router.patch('/fadiga/validacao', requerAdmin, validarFadiga);
router.get('/motoristas/historico', requerAdmin, historicoMotorista);
router.get('/matriz-fadiga', requerAdmin, matrizFadiga);
// Excesso de velocidade (ocorrências, farol do gatilho de 10 s, faixas do Anexo I).
router.get('/velocidade', requerAdmin, analiseVelocidade);
router.patch('/velocidade/validacao', requerAdmin, validarVelocidade);
router.get('/matriz-velocidade', requerAdmin, matrizVelocidade);
router.get('/planos', requerAdmin, listarPlanos);
router.post('/planos', requerAdmin, criarPlano);
router.patch('/planos/:id', requerAdmin, atualizarPlano);
router.delete('/planos/:id', requerAdmin, excluirPlano);
router.post('/importar', requerAdmin, receberPlanilha, importarTelemetria);
router.post('/excluir-lote', requerAdmin, excluirEventosTelemetriaLote);
router.delete('/lote', requerAdmin, excluirEventosTelemetriaLote);
router.post('/', requerAdmin, criarEventoTelemetria);
router.patch('/:id/tratativa', requerAdmin, registrarTratativaTelemetria);
router.delete('/:id', requerAdmin, excluirEventoTelemetria);

export default router;
