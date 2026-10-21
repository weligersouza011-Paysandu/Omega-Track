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
import eficienciaRoutes from './eficienciaRoutes.js';

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
      partes_diarias: '/api/partes-diarias (POST/PUT aceitam formulario completo: cabecalho, horarios, mao_obra, equipamentos, atividades, ocorrencias, comentarios, fotos)',
      parte_assinaturas: 'POST /api/partes-diarias/:id/assinaturas { etapa: OPERADOR|TRANSPORTE|PLANEJADOR, nome }',
      parte_fotos: "POST /api/partes-diarias/:id/fotos (campo `arquivo` + legenda)",
      parte_logs: 'GET /api/partes-diarias/:id/logs',
      parte_ultima_km: 'GET /api/partes-diarias/ultima-km?tag=TAG (&ignorar_id=ID) -> { ultima_km_final } (herança do odômetro; trava: km_final >= km_inicial no POST/PUT)',
      partes_pendentes: '/api/partes-diarias/pendentes (requer x-api-key)',
      pendencias_lancamento: 'GET /api/partes-diarias/pendencias?dias=7 (admin: tudo; operacional: próprias) -> [{ tag, placa, data_pendente, ultimo_operador_id, ultimo_operador_nome }]',
      pendencia_descartar: 'DELETE /api/partes-diarias/pendencias/:tag/:data (ADM/Transporte; cria Parte Diária do dia dá baixa automática)',
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
      eficiencia: 'GET /api/eficiencia?dataInicio=&dataFim=&tag=&modelo=&contrato=&situacao=MOB|DESMOB|TODOS (dashboard: eficiencia por TAG/modelo/mes, KPIs e calendario de paradas; preventiva isenta do denominador)',
      eficiencia_matriz: 'GET /api/eficiencia/matriz?mes=YYYY-MM&tag=&modelo=&contrato=&situacao=TODOS|MOB|DESMOB (Matriz Calendario: status dia a dia por veiculo + observacoes rapidas; sabado/domingo e feriados fora da contagem de pendencias; pior caso quando ha mais de um lancamento no dia; TODA TAG com apontamento no mes aparece, inclusive desmobilizada — historico preservado; padrao TODOS; dias fora da janela mob/desmob expostos via data_mob/data_desmob para bloqueio no front)',
      apontamento_rapido: 'POST /api/partes-diarias/apontamento-rapido { tag, data, status_operacional, observacao? } (somente MASTER; upsert leve da Matriz Calendario — atualiza a classificacao do dia ou cria registro minimo aprovado)',
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

router.get('/ping', (req, res) => {
  res.status(200).json({
    status: 'online',
    message: 'pong',
    timestamp: new Date().toISOString(),
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
router.use('/eficiencia', eficienciaRoutes);

export default router;
