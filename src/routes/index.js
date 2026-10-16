import { Router } from 'express';
import mobDesmobRoutes from './mobDesmobRoutes.js';
import documentacaoRoutes from './documentacaoRoutes.js';
import obraRoutes from './obraRoutes.js';
import parteDiariaRoutes from './parteDiariaRoutes.js';
import manutencaoRoutes from './manutencaoRoutes.js';
import parametroPreventivaRoutes from './parametroPreventivaRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import usuariosRoutes from './usuariosRoutes.js';
import loginRoutes from './loginRoutes.js';

const router = Router();

// Documentacao da API (antes servida na raiz `/`; agora em `/api` para a
// raiz poder entregar a interface React em producao).
router.get('/', (req, res) => {
  res.json({
    name: 'OmegaTrack API',
    description: 'Sistema de gestao de transporte, frota e manutencoes',
    version: process.env.npm_package_version || '1.0.0',
    endpoints: {
      health: '/api/health',
      mob_desmob: '/api/mob-desmob',
      desmobilizar_purga: 'PUT /api/mob-desmob/:tag/desmobilizar { data_desmob?, responsavel?, observacao? }',
      documentacao: '/api/documentacao-veiculos',
      documentacao_farol: '/api/documentacao-veiculos/farol',
      obras: '/api/obras (GET aberto; POST/PUT/DELETE restritos a Gestao/Transporte ou ADM Master)',
      partes_diarias: '/api/partes-diarias (POST/PUT aceitam formulario completo: cabecalho, horarios, mao_obra, equipamentos, atividades, ocorrencias, checklist, comentarios, fotos)',
      parte_assinaturas: 'POST /api/partes-diarias/:id/assinaturas { etapa: OPERADOR|TRANSPORTE|PLANEJADOR, nome }',
      parte_fotos: "POST /api/partes-diarias/:id/fotos (campo `arquivo` + legenda)",
      parte_logs: 'GET /api/partes-diarias/:id/logs',
      parte_ultima_km: 'GET /api/partes-diarias/ultima-km?tag=TAG (&ignorar_id=ID) -> { ultima_km_final } (herança do odômetro; trava: km_final >= km_inicial no POST/PUT)',
      partes_pendentes: '/api/partes-diarias/pendentes (requer x-api-key)',
      upload: '/api/upload?pasta=mobilizacao|partes-diarias|documentos (campo `arquivo`)',
      upload_delete: 'DELETE /api/upload { public_id }',
      usuarios: '/api/usuarios?tipo=ADMINISTRADOR|OPERACIONAL',
      login: 'POST /api/login { matricula, senha? } -> { token, usuario } (OPERACIONAL entra só com matrícula; ADMINISTRADOR exige senha)',
      login_verificar: 'POST /api/login/verificar { matricula } -> { cadastrada, exigeSenha, nome, tipo }',
      foto_veiculo: '/api/mob-desmob/:tag/foto (campo `arquivo` -> foto_veiculo)',
      manutencao_status: 'GET /api/mob-desmob/:tag/status-manutencao?km_atual=&ignorar_parte_id= -> { km_atual, km_rodados_desde_preventiva, km_restantes_para_preventiva, status_alerta: NORMAL|PROXIMO|VENCIDO } (ancora: ultima parte de preventiva > registro manual > 0)',
      manutencao_preventiva: 'POST /api/mob-desmob/:tag/preventiva { km? } (registra preventiva; PUT /:tag aceita km_limite_preventiva/km_ultima_preventiva)',
      manutencao_projecao: 'GET /api/manutencao/projecao-frota -> frota ativa com km_atual, km_restantes, media_km_dia, dias_restantes_estimados, data_prevista_preventiva',
      parametros_preventiva: 'GET /api/parametros-preventiva | GET /categoria/:tipo?contrato= | POST (Gestao/Transporte ou Master) | DELETE /:id',
      anexo_documento: '/api/documentacao-veiculos/:id/anexo (campo `arquivo` -> anexo_url)',
      evidencia_parte: '/api/partes-diarias/:id/evidencia (campo `arquivo` -> evidencia_url)',
    },
  });
});

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OmegaTrack API',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

router.use('/mob-desmob', mobDesmobRoutes);
router.use('/documentacao-veiculos', documentacaoRoutes);
router.use('/obras', obraRoutes);
router.use('/partes-diarias', parteDiariaRoutes);
router.use('/manutencao', manutencaoRoutes);
router.use('/parametros-preventiva', parametroPreventivaRoutes);
router.use('/upload', uploadRoutes);
router.use('/usuarios', usuariosRoutes);
router.use('/login', loginRoutes);

export default router;
