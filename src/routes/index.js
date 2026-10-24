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
import controleAmbientalRoutes from './controleAmbientalRoutes.js';
import programacaoRecursosRoutes from './programacaoRecursosRoutes.js';

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
      desmobilizar_purga: 'PUT /api/mob-desmob/:tag/desmobilizar { data_desmob (obrigatória), responsavel?, observacao? }',
      veiculo_dados_tecnicos: 'PATCH /api/mob-desmob/:tag { chassi?, renavam?, cor?, ano_fabricacao?, ano_modelo?, km_inicial?, combustivel? }',
      documentacao: '/api/documentacao-veiculos',
      documentacao_farol: '/api/documentacao-veiculos/farol',
      obras: '/api/obras (GET aberto; POST/PUT/DELETE restritos a Gestao/Transporte ou ADM Master)',
      programacao_recursos: 'GET /api/programacao-recursos?data=AAAA-MM-DD; PUT /api/programacao-recursos/lote { data, alteracoes: [{ tag, obraId|null, operadorMatricula?, supervisorMatricula? }] }; PUT/DELETE /:data/:tag; POST /copiar-ultima-programacao (Gestao/Transporte ou ADM Master)',
      programacao_manutencoes: 'POST /api/programacao-recursos/manutencoes { tag, tipo: PREVENTIVA|CORRETIVA, dataSaida, previsaoRetorno, descricao }; PATCH /manutencoes/:id/retorno { dataRetorno }',
      partes_diarias: '/api/partes-diarias (POST/PUT aceitam formulario completo; POST limita 2 partes/dia por veiculo para todos os modelos, com bypass MASTER)',
      parte_assinaturas: 'POST /api/partes-diarias/:id/assinaturas { etapa: OPERADOR|TRANSPORTE|PLANEJADOR, nome, salvar_no_perfil? } (Onibus/VAN: apenas OPERADOR + TRANSPORTE; aprovacao automatica no Transporte; salvar_no_perfil=true persiste a imagem como assinatura padrao do usuario logado)',
      parte_fotos: "POST /api/partes-diarias/:id/fotos (campo `arquivo` + legenda)",
      parte_logs: 'GET /api/partes-diarias/:id/logs',
      parte_ultima_km: 'GET /api/partes-diarias/ultima-km?tag=TAG (&ignorar_id=ID) -> { ultima_km_final } (herança do odômetro; trava: km_final >= km_inicial no POST/PUT)',
      partes_pendentes: '/api/partes-diarias/pendentes (requer x-api-key)',
      pendencias_lancamento: 'GET /api/partes-diarias/pendencias?dias=7 (admin: tudo; operacional: próprias) -> [{ tag, placa, data_pendente, ultimo_operador_id, ultimo_operador_nome }]',
      pendencia_descartar: 'DELETE /api/partes-diarias/pendencias/:tag/:data (ADM/Transporte; cria Parte Diária do dia dá baixa automática)',
      upload: '/api/upload?pasta=mobilizacao|partes-diarias|documentos (campo `arquivo`)',
      upload_delete: 'DELETE /api/upload { public_id }',
      usuarios: '/api/usuarios?tipo=ADMINISTRADOR|OPERACIONAL',
      minha_assinatura: 'GET/PUT /api/usuarios/minha-assinatura (qualquer usuário logado; GET -> { assinatura_padrao, assinatura_url, tem_assinatura, usuario }; PUT { assinatura_base64 } | { assinatura_url } | { remover: true })',
      login: 'POST /api/login { matricula, senha? } -> { token, usuario } (OPERACIONAL entra só com matrícula; ADMINISTRADOR exige senha)',
      login_verificar: 'POST /api/login/verificar { matricula } -> { cadastrada, exigeSenha, nome, tipo }',
      foto_veiculo: '/api/mob-desmob/:tag/foto (campo `arquivo` -> foto_veiculo)',
      manutencao_status: 'GET /api/mob-desmob/:tag/status-manutencao?km_atual=&ignorar_parte_id= -> { km_atual, km_rodados_desde_preventiva, km_restantes_para_preventiva, status_alerta: NORMAL|PROXIMO|VENCIDO } (ancora: maior KM entre a ultima parte de preventiva e o registro manual)',
      manutencao_preventiva: 'POST /api/mob-desmob/:tag/preventiva { km? } (registra preventiva; PUT /:tag aceita km_limite_preventiva/km_ultima_preventiva)',
      manutencao_projecao: 'GET /api/manutencao/projecao-frota -> frota ativa com km_atual, km_restantes, media_km_dia (historica ou estimada por modelo/categoria), media_estimada, dias_restantes_estimados, data_prevista_preventiva',
      parametros_preventiva: 'GET /api/parametros-preventiva | GET /categoria/:tipo?contrato= | POST (Gestao/Transporte ou Master) | DELETE /:id',
      anexo_documento: '/api/documentacao-veiculos/:id/anexo (campo `arquivo` -> anexo_url)',
      evidencia_parte: '/api/partes-diarias/:id/evidencia (campo `arquivo` -> evidencia_url)',
      eficiencia: 'GET /api/eficiencia?dataInicio=&dataFim=&tag=&modelo=&contrato=&situacao=MOB|DESMOB|TODOS (dashboard: eficiencia por TAG/modelo/mes, KPIs e calendario de paradas; preventiva isenta do denominador)',
      eficiencia_matriz: 'GET /api/eficiencia/matriz?mes=YYYY-MM&tag=&modelo=&contrato=&situacao=TODOS|MOB|DESMOB (Matriz Calendario: status dia a dia por veiculo + observacoes rapidas; sabado/domingo e feriados fora da contagem de pendencias; dias com 2 lancamentos de status diferentes retornam { duplo, statusEsq, statusDir } para celula dividida, Operacao sempre a esquerda; TODA TAG com apontamento no mes aparece, inclusive desmobilizada — historico preservado; padrao TODOS; dias fora da janela mob/desmob expostos via data_mob/data_desmob para bloqueio no front)',
      apontamento_rapido: 'POST /api/partes-diarias/apontamento-rapido { tag, data, status_operacional, observacao? } (somente MASTER; upsert leve da Matriz Calendario — atualiza a classificacao do dia ou cria registro minimo aprovado)',
      fumaca_preta: 'GET /api/controle-ambiental/fumaca-preta (dashboard de conformidade: KPIs, cobertura e veiculos a diesel mobilizados)',
      fumaca_preta_medicao: 'POST /api/controle-ambiental/fumaca-preta { tag, data_medicao, observacao? } (Gestao/Meio Ambiente/Master; validade calculada em 6 meses)',
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
router.use('/programacao-recursos', programacaoRecursosRoutes);
router.use('/partes-diarias', parteDiariaRoutes);
router.use('/manutencao', manutencaoRoutes);
router.use('/parametros-preventiva', parametroPreventivaRoutes);
router.use('/upload', uploadRoutes);
router.use('/usuarios', usuariosRoutes);
router.use('/login', loginRoutes);
router.use('/eficiencia', eficienciaRoutes);
router.use('/controle-ambiental', controleAmbientalRoutes);

export default router;
