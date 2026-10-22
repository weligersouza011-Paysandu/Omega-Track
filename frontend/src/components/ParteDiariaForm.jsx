import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, ChevronDown, Clock, Users, Truck, ClipboardList,
  AlertTriangle, Camera, PenLine, Save,
  Upload, History, Eye, X, Loader2, CheckCircle2, Search, Check, Gauge, FileText, Building2,
} from 'lucide-react';
import Modal from './Modal.jsx';
import BadgeStatus from './BadgeStatus.jsx';
import ModalAssinaturaDigital from './ModalAssinaturaDigital.jsx';
import RelatorioParteDiariaPreview from './RelatorioParteDiariaPreview.jsx';
import { authHeaders } from '../utils/sessao.js';
import { hojeISO, paraInputData, formatarDataSemTimezone } from '../utils/datas.js';
import { podeAlterarStatusOperacional } from '../utils/permissoes.js';

// Status internos do fluxo de aprovação (mapeados para exibição)
const STATUS_APROVACAO = {
  EM_PREENCHIMENTO: { rotulo: 'Em Preenchimento', cor: { bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-300' } },
  FINALIZADO_OPERADOR: { rotulo: 'Finalizado pelo Operador', cor: { bg: 'bg-amber-50', text: 'text-amber-800', ring: 'ring-amber-300' } },
  REVISADO_TRANSPORTE: { rotulo: 'Revisado pelo Transporte', cor: { bg: 'bg-red-50', text: 'text-red-800', ring: 'ring-red-300' } },
  APROVADO: { rotulo: 'Aprovado', cor: { bg: 'bg-green-50', text: 'text-green-800', ring: 'ring-green-300' } },
};

// Status legados (mantidos para retrocompatibilidade de leitura)
const STATUS_RELATORIO = [
  { valor: 'PREENCHENDO', rotulo: 'Em Preenchimento' },
  { valor: 'REVISAO', rotulo: 'Em Revisão' },
  { valor: 'APROVADO', rotulo: 'Aprovado' },
];

// Mapeia status_relatorio → aprovacao key
function normalizarModeloVeiculo(modelo) {
  return String(modelo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function resolverStatusAprovacao(statusRelatorio, assinaturas = [], ehOnibus = false) {
  const temOp = assinaturas.some((a) => String(a.etapa).toUpperCase() === 'OPERADOR');
  const temTr = assinaturas.some((a) => String(a.etapa).toUpperCase() === 'TRANSPORTE');
  const temPl = assinaturas.some((a) => String(a.etapa).toUpperCase() === 'PLANEJADOR');
  if (statusRelatorio === 'APROVADO') return 'APROVADO';
  // Ônibus: o Transporte é a etapa final e o Planejamento não participa.
  if (ehOnibus) {
    if (temTr) return 'APROVADO';
    if (temOp) return 'FINALIZADO_OPERADOR';
    return 'EM_PREENCHIMENTO';
  }
  if (temPl) return 'APROVADO';
  if (temTr) return 'REVISADO_TRANSPORTE';
  if (temOp) return 'FINALIZADO_OPERADOR';
  return 'EM_PREENCHIMENTO';
}


const ETAPAS = [
  { valor: 'OPERADOR', rotulo: 'Operador' },
  { valor: 'TRANSPORTE', rotulo: 'Transporte' },
  { valor: 'PLANEJADOR', rotulo: 'Planejador' },
];
const ETAPAS_ONIBUS = ETAPAS.filter((etapa) => etapa.valor !== 'PLANEJADOR');
// Status Operacional do Dia (cabeçalho — campo obrigatório)
const STATUS_OPERACIONAL_DIA = [
  'Operação',
  'Manutenção Corretiva',
  'Manutenção Preventiva',
  'Indisponibilidade',
  'Interdição',
  'Não Operado',
];
const ROTULOS_STATUS_OPERACIONAL = {
  'Não Operado': 'Não Operado / Folga',
};
const CORES_STATUS_OPERACIONAL = {
  'Operação': 'bg-emerald-600 border-emerald-700 text-white',
  'Manutenção Preventiva': 'bg-amber-600 border-amber-700 text-white',
  'Manutenção Corretiva': 'bg-red-600 border-red-700 text-white',
  'Interdição': 'bg-orange-600 border-orange-700 text-white',
  'Indisponibilidade': 'bg-purple-600 border-purple-700 text-white',
  'Não Operado': 'bg-slate-600 border-slate-700 text-white',
  'Folga': 'bg-slate-600 border-slate-700 text-white',
};
const HORARIOS_PADRAO_JORNADA = {
  horario_entrada: '07:00',
  horario_saida: '17:00',
  intervalo_entrada: '12:00',
  intervalo_saida: '13:00',
};
// Segunda a quinta: jornada padrão 07:00–17:00, intervalo 12:00–13:00.
function horariosPadraoDaData(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const dia = d.getDay();
  return dia >= 1 && dia <= 4 ? HORARIOS_PADRAO_JORNADA : null;
}
function aplicarHorariosPadraoJornada(form) {
  const padrao = horariosPadraoDaData(form?.data);
  if (!padrao) return form;
  let alterou = false;
  const proximo = { ...form };
  for (const [campo, valor] of Object.entries(padrao)) {
    if (!String(proximo[campo] ?? '').trim()) {
      proximo[campo] = valor;
      alterou = true;
    }
  }
  return alterou ? proximo : form;
}
// Segregação do formulário (Fase Sênior 3): operação completa, preventiva
// enxuta (obra + veículo + KM) e parada super enxuta (obra + data + veículo).
function modoDoStatus(status) {
  if (status === 'Manutenção Preventiva') return 'preventiva';
  if (['Manutenção Corretiva', 'Indisponibilidade', 'Interdição', 'Não Operado'].includes(status)) return 'parada';
  return 'operacao';
}
const TIPOS_OCORRENCIA = ['Operacional', 'Segurança', 'Meio Ambiente', 'Mecânica', 'Outra'];
const STATUS_ATIVIDADE = ['Pendente', 'Em Andamento', 'Concluído'];

// Cores dos badges de status da atividade
const COR_STATUS_ATIV = {
  Pendente: 'bg-red-100 text-red-700 ring-red-600/20',
  'Em Andamento': 'bg-blue-100 text-blue-700 ring-blue-600/20',
  'Concluído': 'bg-green-100 text-green-700 ring-green-600/20',
};

const STATUS_EQUIP = ['Operacional', 'Standby', 'Manutenção'];

const DIAS_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function diaSemanaDe(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return DIAS_PT[d.getDay()];
}

// Trava do odômetro (espelha o backend): KM Final nunca abaixo da KM Inicial.
// Retorna a mensagem de erro ou null quando consistente.
function erroQuilometragemTexto(kmInicial, kmFinal) {
  const ini = kmInicial === '' || kmInicial == null ? null : Number(kmInicial);
  const fim = kmFinal === '' || kmFinal == null ? null : Number(kmFinal);
  if (ini !== null && fim !== null && Number.isFinite(ini) && Number.isFinite(fim) && fim < ini) {
    return `A KM Final não pode ser menor que a KM Inicial (${kmInicial})`;
  }
  return null;
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function estadoVazio(usuario, data = hojeISO()) {
  return aplicarHorariosPadraoJornada({
    data,
    numero_contrato: '4800001236',
    obra: '',
    obra_id: '',
    contratante: 'Vale',
    responsavel: '',
    planejador: '',
    horario_entrada: '',
    horario_saida: '',
    intervalo_entrada: '',
    intervalo_saida: '',
    status_relatorio: 'PREENCHENDO',
    status_operacional: 'Operação',
    km_inicial: '',
    km_final: '',
    // Primeiro registro = usuário logado (autoria/rastreabilidade do lançamento)
    mao_obra: usuario?.nome || usuario?.matricula
      ? [{
        nome: usuario?.nome || '',
        matricula: usuario?.matricula || '',
        funcao: usuario?.funcao || '',
        horario: '',
        observacao: '',
      }]
      : [],
    equipamentos: [],
    atividades: [],
    ocorrencias: [],
    fotos: [],
  });
}

function Secao({ icone: Icone, titulo, count, aberto, onToggle, onAdicionar, labelAdicionar, temErro, children }) {
  return (
    <div className={`card overflow-hidden transition-all duration-300 ${temErro ? '!border-red-400 ring-2 ring-red-500/50 shadow-md shadow-red-500/10' : ''}`}>
      {/* Título em linha própria (nunca corta) + "+ Adicionar" abaixo no mobile */}
      <div className={`px-4 py-3 ${temErro ? 'bg-red-50/50' : ''}`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full">
          <button onClick={onToggle} type="button" className="flex items-center gap-2 flex-1 min-w-0 w-full text-left">
            <span className={`p-1.5 rounded-lg text-white shrink-0 ${temErro ? 'bg-red-600' : 'bg-omega-900'}`}>
              <Icone size={14} />
            </span>
            <span className={`text-base font-bold ${temErro ? 'text-red-900' : 'text-omega-900'}`}>{titulo}</span>
            <span className={`chip shrink-0 ${temErro ? 'bg-red-100 text-red-800' : 'bg-omega-100 text-omega-700'}`}>({count})</span>
            <ChevronDown size={15} className={`ml-auto text-omega-400 transition-transform shrink-0 ${aberto ? 'rotate-180' : ''}`} />
          </button>
          {onAdicionar && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAdicionar(); }}
              className={`${temErro ? 'btn-primary !bg-red-600 hover:!bg-red-700' : 'btn-secondary'} !py-1.5 !px-2.5 text-xs w-full sm:w-auto mt-1 sm:mt-0 justify-center shrink-0`}
            >
              <Plus size={14} /> {labelAdicionar || 'Adicionar'}
            </button>
          )}
        </div>
      </div>
      {aberto && <div className="px-4 pb-4 pt-1 border-t border-omega-100 space-y-3">{children}</div>}
    </div>
  );
}

function LinhaVazia({ texto }) {
  return (
    <div className="text-xs text-omega-400 italic border border-dashed border-omega-200 rounded-lg px-3 py-2.5 text-center">
      {texto}
    </div>
  );
}

// Combobox de TAGs: busca integrada sobre a frota ativa, com placa/modelo
// visíveis, hover/focus suaves e fechamento por clique fora ou Escape.
function TagCombobox({ veiculos = [], value, onSelect, inputCls }) {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef(null);

  useEffect(() => {
    const fora = (e) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target)) setAberto(false);
    };
    const tecla = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, []);

  const normalizar = (v) => String(v || '').toUpperCase();
  const filtrados = useMemo(() => {
    const q = normalizar(busca);
    const lista = (veiculos || []).filter((v) => v?.tag);
    if (!q) return lista.slice(0, 50);
    return lista.filter((v) =>
      normalizar(v.tag).includes(q) ||
      normalizar(v.placa).includes(q) ||
      normalizar(v.modelo).includes(q)
    ).slice(0, 50);
  }, [veiculos, busca]);

  const selecionado = (veiculos || []).find((v) => normalizar(v.tag) === normalizar(value));
  const rotulo = selecionado
    ? `${selecionado.tag}${selecionado.placa ? ` • ${selecionado.placa}` : ''}`
    : (value || '');

  return (
    <div ref={caixaRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-omega-400 pointer-events-none" />
        <input
          value={aberto ? busca : rotulo}
          onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
          onFocus={() => { setBusca(''); setAberto(true); }}
          className={`${inputCls} !pl-8 pr-8 font-mono uppercase placeholder:normal-case placeholder:font-sans`}
          placeholder="Buscar TAG ou placa..."
        />
        {value && (
          <button
            onClick={() => onSelect('')}
            title="Limpar veículo"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-omega-300 hover:text-omega-700 hover:bg-omega-100 transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {aberto && (
        <div className="absolute z-20 mt-1.5 w-full max-h-60 overflow-auto rounded-xl border border-omega-200 bg-white shadow-xl">
          {filtrados.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-omega-400 italic">Nenhum veículo encontrado.</div>
          )}
          {filtrados.map((v) => {
            const ativo = normalizar(v.tag) === normalizar(value);
            return (
              <button
                key={v.tag}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onSelect(v.tag); setAberto(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${ativo ? 'bg-omega-900/[0.04]' : 'hover:bg-omega-50'}`}
              >
                <span className="font-mono font-bold text-omega-900">{v.tag}</span>
                <span className="text-xs text-omega-400 font-mono truncate">
                  {v.placa || '—'}{v.modelo ? ` • ${v.modelo}` : ''}
                </span>
                {ativo && <Check size={14} className="ml-auto text-status-verde shrink-0" />}
              </button>
            );
          })}
          <div className="px-3 py-1.5 border-t border-omega-100 text-[11px] text-omega-400">
            {filtrados.length} veículo(s) • frota cadastrada
          </div>
        </div>
      )}
    </div>
  );
}

export default function ParteDiariaForm({ open, onClose, sessao, veiculos = [], inicial = null, prefill = null, onSalvo, onSave, onAtualizar }) {
  const usuario = sessao?.usuario || null;
  // Perfil operacional (nao-admin): Status Operacional do Dia fixado em
  // 'Operação' — sem acesso a paradas/manutenções (trava no payload também).
  const statusTravado = !podeAlterarStatusOperacional(usuario);
  // Lancamento retroativo (auditoria de pendencias): data e veiculo do dia
  // pendente vêm travados no formulario — o registro não pode "vazar" para
  // outro dia/frota ao salvar.
  const dataTravada = !inicial?.id && !!prefill?.data && prefill?.travar === true;
  const tagTravada = dataTravada && prefill?.tag ? String(prefill.tag).trim().toUpperCase() : null;
  const [usuarios, setUsuarios] = useState([]);
  // Função do logado resolvida no cadastro fresco (/api/usuarios), com fallback
  // para a sessão (que pode ser anterior ao campo `funcao` ou estar sem o valor).
  // Cobre `funcao` e o alias `funcaoUser`.
  const funcaoDoLogado = useMemo(() => {
    const norm = (v) => String(v || '').trim().toUpperCase();
    const registro = (usuarios || []).find((u) =>
      (usuario?.matricula && norm(u.matricula) === norm(usuario.matricula)) ||
      (usuario?.nome && norm(u.nome) === norm(usuario.nome))
    );
    return registro?.funcao || registro?.funcaoUser || usuario?.funcao || usuario?.funcaoUser || '';
  }, [usuarios, usuario]);
  const [form, setForm] = useState(() => estadoVazio(usuario));
  const [assinaturas, setAssinaturas] = useState([]);
  const [auditoria, setAuditoria] = useState({ criado_por: null, atualizado_por: null, updated_at: null, visualizacoes: 0, logs: [] });
  const [parteId, setParteId] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [autosave, setAutosave] = useState(null); // null | 'salvando' | 'salvo HH:MM' | 'erro'
  const [erro, setErro] = useState(null);
  const [errosValidacao, setErrosValidacao] = useState({});
  // Registro já existente para o par (veículo, dia): o formulário deixa de
  // criar um novo e passa a editar esse lançamento (inclusive o retroativo).
  const [parteExistente, setParteExistente] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [nomesAssinatura, setNomesAssinatura] = useState({});
  const [secoes, setSecoes] = useState({ cabecalho: true, horario: true, mao: true, equip: false, ativ: true, ocor: false, fotos: false, assin: true });
  const [verLogs, setVerLogs] = useState(false);
  const [verRelatorio, setVerRelatorio] = useState(false);
  const [obras, setObras] = useState([]);
  // Herança do odômetro: KM Inicial herdada da última KM Final do veículo.
  const [kmHerdada, setKmHerdada] = useState(false);
  const [kmOrigem, setKmOrigem] = useState(null); // ex: "12/10/2026 • PD-ABC123"
  // Motivo da parada (modo frota parada): vira a ocorrência do relatório.
  const [motivoParada, setMotivoParada] = useState('');
  // Diagnóstico da preventiva do veículo principal (banners do bloco de KM).
  const [manutencao, setManutencao] = useState(null);
  const manutencaoReqRef = useRef(0);
  const formRef = useRef(null);
  formRef.current = form;

  const sujoRef = useRef(false);
  const pularAutosaveRef = useRef(true);
  const timerRef = useRef(null);
  const fileRef = useRef(null);
  // Descarta respostas atrasadas de carregamento (troca rápida de registro).
  const carregamentoParteRef = useRef(0);

  const tagPrincipal = useMemo(() => {
    const lista = (form.equipamentos || [])
      .map((e) => String(e.tag_patrimonio || '').trim().toUpperCase())
      .filter(Boolean);
    return lista[0] || '';
  }, [form.equipamentos]);

  const veiculoPrincipal = useMemo(() => {
    const norm = (v) => String(v || '').trim().toUpperCase();
    const equipamento = (form.equipamentos || []).find((e) => String(e.tag_patrimonio || '').trim());
    const ficha = (veiculos || []).find((v) => norm(v?.tag) === norm(tagPrincipal));
    return {
      ...ficha,
      modelo: ficha?.modelo || equipamento?.descricao || '',
    };
  }, [form.equipamentos, tagPrincipal, veiculos]);

  const ehOnibus = useMemo(
    () => normalizarModeloVeiculo(veiculoPrincipal?.modelo) === 'ONIBUS',
    [veiculoPrincipal],
  );
  const etapasAssinatura = ehOnibus ? ETAPAS_ONIBUS : ETAPAS;

  const alternarSecao = (k) => setSecoes((s) => ({ ...s, [k]: !s[k] }));

  const limparErroCampo = useCallback((campo) => {
    setErrosValidacao((prev) => {
      if (!prev || !prev[campo]) return prev;
      const copy = { ...prev };
      delete copy[campo];
      return copy;
    });
  }, []);

  const notificarSucesso = useCallback((msg, opts) => {
    if (typeof onSalvo === 'function') onSalvo(msg, opts);
    if (typeof onSave === 'function' && onSave !== onSalvo) onSave(msg, opts);
    if (typeof onAtualizar === 'function') onAtualizar(msg, opts);
  }, [onSalvo, onSave, onAtualizar]);

  const executarScrollParaElemento = useCallback((id) => {
    if (!id) return;
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const elementoFocavel = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'
          ? el
          : el.querySelector('input, select, textarea, button');
        if (elementoFocavel && typeof elementoFocavel.focus === 'function') {
          try {
            elementoFocavel.focus({ preventScroll: true });
          } catch {
            /* noop */
          }
        }
      }
    }, 80);
  }, []);

  const definir = useCallback((campo, valor) => {
    sujoRef.current = true;
    limparErroCampo(campo);
    setForm((f) => ({ ...f, [campo]: valor }));
  }, [limparErroCampo]);

  // Status Operacional do Dia: perfil operacional não altera (fixo em Operação).
  const definirStatusOperacional = (valor) => {
    if (statusTravado) return;
    limparErroCampo('status_operacional');
    definir('status_operacional', valor);
  };

  // Domingo fora da grade: a data não aceita domingos (operação seg–sáb).
  const [erroData, setErroData] = useState(null);
  const definirData = (iso) => {
    if (dataTravada) return; // retroativo: data do dia pendente fica travada
    limparErroCampo('data');
    if (!iso) {
      setErroData(null);
      definir('data', iso);
      return;
    }
    const d = new Date(`${iso}T12:00:00`);
    if (!Number.isNaN(d.getTime()) && d.getDay() === 0) {
      setErroData('Domingo não faz parte da grade de trabalho. Escolha outro dia.');
      return;
    }
    setErroData(null);
    sujoRef.current = true;
    setForm((f) => aplicarHorariosPadraoJornada({ ...f, data: iso }));
  };

  // KM Inicial manual invalida o selo de herança (valor passa a ser do operador).
  const definirKmInicial = (valor) => {
    setKmHerdada(false);
    setKmOrigem(null);
    limparErroCampo('km_final');
    definir('km_inicial', valor);
  };

  // Seleção de obra (dropdown): preenche automaticamente contrato,
  // contratante, gestão/responsável e planejador a partir do cadastro.
  const selecionarObra = useCallback((obraId) => {
    limparErroCampo('obra');
    if (obraId === '__legado__') return; // mantém o texto legado
    sujoRef.current = true;
    setForm((f) => {
      if (!obraId) return { ...f, obra_id: '', obra: '' };
      const obra = obras.find((o) => o.id === obraId);
      if (!obra) return { ...f, obra_id: '', obra: '' };
      return {
        ...f,
        obra_id: obra.id,
        obra: obra.nome,
        numero_contrato: obra.numeroContrato || f.numero_contrato,
        contratante: obra.contratante || f.contratante,
        responsavel: obra.gestao || f.responsavel,
        planejador: obra.planejador || f.planejador,
      };
    });
  }, [obras, limparErroCampo]);

  // ------- obras ativas (dropdown do cabeçalho) + usuários (função da mão de obra) -------
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    (async () => {
      try {
        const resp = await fetch('/api/obras?ativo=true&limit=200', { headers: authHeaders(sessao) });
        if (!resp.ok) return;
        const corpo = await resp.json();
        if (vivo) setObras(Array.isArray(corpo?.data) ? corpo.data : []);
      } catch {
        /* dropdown segue com lista vazia */
      }
      try {
        const resp = await fetch('/api/usuarios', { headers: authHeaders(sessao) });
        if (!resp.ok) return;
        const corpo = await resp.json();
        if (vivo) setUsuarios(Array.isArray(corpo?.data) ? corpo.data : []);
      } catch {
        /* função segue manual/vazia */
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ------- carregar relatório existente (edição) -------
  // Usado pela listagem e pela regra de reaproveitamento: se o veículo já
  // possui parte diária no dia, este registro é aberto para edição em vez de
  // criar um duplicado (lançamento retroativo incluso).
  const carregarParteParaEdicao = useCallback(async (id, opcoes = {}) => {
    if (!id) return false;
    const { existente = false, manterSelecao = null } = opcoes;
    const idCarregamento = ++carregamentoParteRef.current;
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch(`/api/partes-diarias/${id}`, { headers: authHeaders(sessao) });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.message || `Falha ao carregar (API ${resp.status})`);
      }
      const { data: p } = await resp.json();
      if (idCarregamento !== carregamentoParteRef.current) return false;
      // O operador trocou data/veículo enquanto o registro carregava: não
      // sobrescreve a seleção atual com um lançamento de outro dia/frota.
      if (manterSelecao) {
        const dataAtual = String(formRef.current?.data || '').trim();
        const tagAtual = String(
          (formRef.current?.equipamentos || []).find((e) => String(e.tag_patrimonio || '').trim())?.tag_patrimonio || '',
        ).trim().toUpperCase();
        if (dataAtual !== manterSelecao.data || tagAtual !== manterSelecao.tag) return false;
      }
      pularAutosaveRef.current = true;
      sujoRef.current = false;
      setParteId(p.id);
      // Migração suave: registros antigos sem módulos ganham o autor original
      // na mão de obra e o TAG legado vira o primeiro equipamento.
      const maoBase = (p.mao_obra || []).map((i) => ({
        nome: i.nome || '',
        matricula: i.matricula || '',
        funcao: i.funcao || '',
        horario: i.horario || '',
        observacao: i.observacao || '',
      }));
      if (maoBase.length === 0) {
        const autorOriginal = {
          nome: p.funcionario || p.criado_por || '',
          matricula: p.operador || '',
          funcao: p.funcao || '',
        };
        if (autorOriginal.nome || autorOriginal.matricula) {
          maoBase.push({ ...autorOriginal, horario: '', observacao: '' });
        } else if (usuario?.nome || usuario?.matricula) {
          maoBase.push({
            nome: usuario?.nome || '',
            matricula: usuario?.matricula || '',
            funcao: usuario?.funcao || '',
            horario: '',
            observacao: '',
          });
        }
      }
      const equipBase = (p.equipamentos || []).map((i) => ({
        tag_patrimonio: i.tag_patrimonio || '',
        descricao: i.descricao || '',
        horimetro_inicial: i.horimetro_inicial || '',
        horimetro_final: i.horimetro_final || '',
        status: i.status || 'Operacional',
      }));
      if (equipBase.length === 0 && p.tag) {
        equipBase.push({
          tag_patrimonio: p.tag,
          descricao: p.veiculo?.modelo || '',
          horimetro_inicial: '',
          horimetro_final: '',
          status: 'Operacional',
        });
      }
      setForm(aplicarHorariosPadraoJornada({
        data: paraInputData(p.data),
        numero_contrato: p.numero_contrato || '',
        obra: p.obra || '',
        obra_id: p.obra_id || p.obra_ref?.id || '',
        contratante: p.contratante || '',
        responsavel: p.responsavel || '',
        planejador: p.planejador || '',
        horario_entrada: p.horario_entrada || '',
        horario_saida: p.horario_saida || '',
        intervalo_entrada: p.intervalo_entrada || '',
        intervalo_saida: p.intervalo_saida || '',
        status_relatorio: p.status_relatorio || 'PREENCHENDO',
        status_operacional: statusTravado ? 'Operação' : (p.status_operacional || p.status || 'Operação'),
        km_inicial: p.km_inicial ?? '',
        km_final: p.km_final ?? '',
        mao_obra: maoBase,
        equipamentos: equipBase,
        atividades: (p.atividades || []).map((i) => ({
          descricao: i.descricao || '',
          // Normaliza rótulos legados para o padrão atual
          status: i.status === 'Em andamento' ? 'Em Andamento' : i.status === 'Concluída' ? 'Concluído' : (i.status || 'Pendente'),
        })),
        ocorrencias: (p.ocorrencias || []).map((i) => ({
          // Normaliza rótulo legado para o padrão atual
          tipo: i.tipo === 'Ambiental' ? 'Meio Ambiente' : (TIPOS_OCORRENCIA.includes(i.tipo) ? i.tipo : 'Operacional'),
          descricao: i.descricao || '',
        })),
        fotos: (p.fotos || []).map((i) => ({ url: i.url, legenda: i.legenda || '', public_id: i.public_id || '' })),
      }));
      // Registro carregado traz a própria KM (não é herança).
      setKmHerdada(false);
      setKmOrigem(null);
      // Motivo da parada (reeditável no modo frota parada).
      setMotivoParada((p.ocorrencias || [])[0]?.descricao || '');
      setAssinaturas(p.assinaturas || []);
      setAuditoria({
        criado_por: p.criado_por || null,
        atualizado_por: p.atualizado_por || null,
        updated_at: p.updated_at || null,
        visualizacoes: p.visualizacoes || 0,
        logs: p.logs || [],
      });
      setNomesAssinatura({});
      setParteExistente(existente ? {
        id: p.id,
        tag: p.tag,
        data: p.data,
        numero_relatorio: p.numero_relatorio || null,
      } : null);
      return true;
    } catch (e) {
      if (idCarregamento === carregamentoParteRef.current) {
        setErro(e.message || 'Falha ao carregar relatório.');
      }
      return false;
    } finally {
      if (idCarregamento === carregamentoParteRef.current) setCarregando(false);
    }
  }, [sessao, usuario, statusTravado]);

  useEffect(() => {
    if (!open) return;
    setErro(null);
    setErroData(null);
    setErrosValidacao({});
    setAutosave(null);
    setVerLogs(false);
    setParteExistente(null);
    if (!inicial?.id) {
      // Invalida carregamentos pendentes e volta ao modo "novo relatório".
      carregamentoParteRef.current += 1;
      setCarregando(false);
      pularAutosaveRef.current = true;
      sujoRef.current = false;
      setParteId(null);
      // Pre-preenchimento do lancamento retroativo (auditoria de pendencias):
      // data do dia pendente + veiculo correspondente ja no 1º equipamento.
      const dataBase = prefill?.data ? paraInputData(prefill.data) : hojeISO();
      const base = estadoVazio(usuario, dataBase);
      if (prefill?.tag) {
        const tag = String(prefill.tag).trim().toUpperCase();
        const veiculo = (veiculos || []).find((v) => String(v?.tag || '').toUpperCase() === tag);
        base.equipamentos = [{
          tag_patrimonio: tag,
          descricao: veiculo?.modelo || veiculo?.placa || '',
          horimetro_inicial: '',
          horimetro_final: '',
          status: 'Operacional',
        }];
      }
      setForm(base);
      setKmHerdada(false);
      setKmOrigem(null);
      setMotivoParada('');
      setAssinaturas([]);
      setAuditoria({ criado_por: null, atualizado_por: null, updated_at: null, visualizacoes: 0, logs: [] });
      setNomesAssinatura({});
      return;
    }
    carregarParteParaEdicao(inicial.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inicial?.id]);

  // ------- reutilização do lançamento do dia (data + veículo) -------
  // Busca a parte diária já existente para TAG + data (respeitando o escopo
  // de visibilidade da API). Retorna o registro mais recente + total do dia.
  const buscarParteDoDia = useCallback(async (tag, dataISO) => {
    const t = String(tag || '').trim().toUpperCase();
    const d = String(dataISO || '').trim();
    if (!t || !d) return null;
    try {
      const params = new URLSearchParams({
        tag: t,
        data_inicio: d,
        data_fim: d,
        limit: '10',
        _t: String(Date.now()),
      });
      const resp = await fetch(`/api/partes-diarias?${params.toString()}`, { headers: authHeaders(sessao) });
      if (!resp.ok) return null;
      const corpo = await resp.json().catch(() => ({}));
      const existentes = Array.isArray(corpo?.data) ? corpo.data : [];
      const parte = existentes.find((p) => String(p?.tag || '').toUpperCase() === t) || existentes[0] || null;
      const total = Number(corpo?.pagination?.total);
      return { parte, total: Number.isFinite(total) ? total : existentes.length };
    } catch {
      return null;
    }
  }, [sessao]);

  // Antes de criar um novo relatório, consulta se o veículo principal já tem
  // parte diária na data. Se existir (e o limite do dia estiver esgotado),
  // carrega esse registro no próprio formulário (edição retroativa) — nunca
  // cria duplicado silencioso. No fluxo retroativo travado, qualquer registro
  // existente é reaberto para edição.
  useEffect(() => {
    if (!open || carregando) return;
    if (inicial?.id || parteId) return;
    const dataISO = String(form.data || '').trim();
    const tag = tagPrincipal;
    if (!dataISO || !tag) return;
    let cancelado = false;
    const timer = setTimeout(async () => {
      const encontrado = await buscarParteDoDia(tag, dataISO);
      const alvo = encontrado?.parte;
      if (!alvo?.id || cancelado) return;
      // Fora do retroativo travado, respeita o limite diário do veículo
      // (ônibus aceita 2 registros; os demais, 1).
      const retroativoTravado = prefill?.travar === true;
      const limite = ehOnibus ? 2 : 1;
      if (!retroativoTravado && Number(encontrado.total) < limite) return;
      // Evita carregar registro antigo se o operador trocou data/veículo
      // enquanto a consulta estava em andamento.
      if (String(formRef.current?.data || '').trim() !== dataISO) return;
      const tagAtual = String(
        (formRef.current?.equipamentos || []).find((e) => String(e.tag_patrimonio || '').trim())?.tag_patrimonio || '',
      ).trim().toUpperCase();
      if (tagAtual !== tag) return;
      await carregarParteParaEdicao(alvo.id, { existente: true, manterSelecao: { data: dataISO, tag } });
    }, 450);
    return () => { cancelado = true; clearTimeout(timer); };
  }, [open, carregando, inicial?.id, parteId, form.data, tagPrincipal, prefill?.travar, ehOnibus, buscarParteDoDia, carregarParteParaEdicao]);

  // ------- persistência -------
  // TAG deriva do 1º equipamento; autoria (funcionário/operador/função), usada
  // na listagem e no filtro por perfil, vem da 1ª linha de mão de obra travada.
  const montarPayload = useCallback((f = form, listaAssin = assinaturas) => {
    const veiculoPrincipal = (f.equipamentos || []).find((e) => String(e.tag_patrimonio || '').trim());
    const maoTravada = (f.mao_obra || []).map((r, idx) => (idx === 0 ? {
      ...r,
      nome: String(r.nome || '').trim(),
      matricula: String(r.matricula || '').trim(),
      funcao: r.funcao || '',
    } : {
      ...r,
      // Auxiliares sem função resolvida assumem o cargo default "Sinaleiro"
      funcao: r.funcao || 'Sinaleiro',
    }));
    const responsavelJornada = maoTravada[0] || {};
    // Perfil operacional: payload sempre em Operação (trava de status).
    const statusOperacionalEfetivo = statusTravado ? 'Operação' : (f.status_operacional || 'Operação');
    // Modo do relatório: no modo parada, o motivo vira a ocorrência registrada.
    const modoPayload = modoDoStatus(statusOperacionalEfetivo);
    const motivoTrim = String(motivoParada || '').trim();
    const ocorrenciasPayload = modoPayload === 'parada' && motivoTrim
      ? [{ tipo: 'Operacional', descricao: motivoTrim }]
      : (f.ocorrencias || []).map((o) => ({ tipo: o.tipo, descricao: o.descricao }));
    // Status de aprovação derivado das assinaturas presentes (espelha o backend).
    // Em ônibus o Transporte é a etapa final; nos demais, o Planejamento.
    const etapasAssin = new Set((listaAssin || []).map((a) => String(a.etapa || '').toUpperCase()));
    const aprovado = ehOnibus ? etapasAssin.has('TRANSPORTE') : etapasAssin.has('PLANEJADOR');
    const statusAprovacao = aprovado
      ? 'Aprovado'
      : etapasAssin.has('TRANSPORTE')
        ? 'Revisado pelo Transporte'
        : etapasAssin.has('OPERADOR')
          ? 'Finalizado pelo Operador'
          : 'Em Preenchimento';
    return {
      data: f.data,
      numero_contrato: String(f.numero_contrato || '').trim() || null,
      obra: String(f.obra || '').trim(),
      obra_id: f.obra_id || null,
      contratante: String(f.contratante || '').trim() || null,
      responsavel: String(f.responsavel || '').trim() || null,
      planejador: String(f.planejador || '').trim() || null,
      horario_entrada: f.horario_entrada || null,
      horario_saida: f.horario_saida || null,
      intervalo_entrada: f.intervalo_entrada || null,
      intervalo_saida: f.intervalo_saida || null,
      status_relatorio: f.status_relatorio,
      status_operacional: statusOperacionalEfetivo,
      status_aprovacao: statusAprovacao,
      tag: String(veiculoPrincipal?.tag_patrimonio || '').trim().toUpperCase(),
      status: statusOperacionalEfetivo,
      funcionario: String(responsavelJornada.nome || '').trim() || usuario?.nome || null,
      operador: String(responsavelJornada.matricula || '').trim() || usuario?.matricula || null,
      funcao: String(responsavelJornada.funcao || '').trim() || null,
      km_inicial: String(f.km_inicial ?? '').trim() || null,
      km_final: String(f.km_final ?? '').trim() || null,
      mao_obra: maoTravada,
      equipamentos: f.equipamentos,
      // Blocos simplificados: só trafegam os campos exibidos (sem duplicados/legados)
      atividades: (f.atividades || []).map((a) => ({ descricao: a.descricao, status: a.status })),
      ocorrencias: ocorrenciasPayload,
      fotos: f.fotos,
    };
  }, [form, assinaturas, usuario, funcaoDoLogado, motivoParada, statusTravado, ehOnibus]);

  const aplicarResposta = useCallback((p) => {
    if (!p) return;
    setParteId(p.id);
    setAssinaturas(p.assinaturas || []);
    setAuditoria({
      criado_por: p.criado_por ?? null,
      atualizado_por: p.atualizado_por ?? null,
      updated_at: p.updated_at ?? null,
      visualizacoes: p.visualizacoes ?? 0,
      logs: p.logs || [],
    });
  }, []);

  // Validação por modo: operação exige obra + veículo + status; manutenção e
  // parada exigem só veículo + status (obra oculta/opcional). Preventiva exige
  // também a KM (âncora do ciclo).
  // Validação explícita de campos obrigatórios com mapeamento de IDs do DOM
  const validarFormulario = useCallback((f = form) => {
    const novosErros = {};
    const pendentes = [];
    let primeiroId = null;

    const marcarErro = (campo, id, mensagem) => {
      novosErros[campo] = mensagem;
      pendentes.push(mensagem);
      if (!primeiroId) primeiroId = id;
    };

    // 1. Data
    if (!f.data) {
      marcarErro('data', 'campo-data', 'Data é obrigatória');
    } else if (erroData) {
      marcarErro('data', 'campo-data', erroData);
    }

    // 2. Status Operacional do Dia
    if (!STATUS_OPERACIONAL_DIA.includes(f.status_operacional)) {
      marcarErro('status_operacional', 'campo-status-operacional', 'Status Operacional do Dia é obrigatório');
    }

    // 3. Obra (obrigatória para o modo Operação)
    const modoAtual = modoDoStatus(f.status_operacional);
    if (modoAtual === 'operacao' && !String(f.obra || '').trim()) {
      marcarErro('obra', 'campo-obra', 'Obra é obrigatória para relatórios em Operação');
    }

    // 4. Veículo em Equipamentos (obrigatório em todos os modos)
    const temVeiculo = (f.equipamentos || []).some((e) => String(e.tag_patrimonio || '').trim());
    if (!temVeiculo) {
      marcarErro('equipamentos', 'campo-equipamentos', 'Veículo é obrigatório (adicione um veículo em Equipamentos)');
      setSecoes((s) => ({ ...s, equip: true }));
    }

    // 5. Quilometragem
    if (modoAtual === 'preventiva') {
      if (String(f.km_final ?? '').trim() === '') {
        marcarErro('km_final', 'campo-km-final', 'KM da Preventiva é obrigatória');
      }
    } else {
      const msgKm = erroQuilometragemTexto(f.km_inicial, f.km_final);
      if (msgKm) {
        marcarErro('km_final', 'campo-km-final', msgKm);
      }
    }

    setErrosValidacao(novosErros);
    const valido = Object.keys(novosErros).length === 0;
    return { valido, pendentes, primeiroId, erros: novosErros };
  }, [form, erroData]);

  const relatorioValido = (f = form) => {
    const { valido } = validarFormulario(f);
    return valido;
  };

  // Trava do odômetro em tempo real (espelha o backend).
  // Preventiva: isenta (lançamento retroativo livre, só exige KM > 0).
  const erroKm = useMemo(
    () => (modoDoStatus(form.status_operacional) === 'preventiva'
      ? null
      : erroQuilometragemTexto(form.km_inicial, form.km_final)),
    [form.km_inicial, form.km_final, form.status_operacional],
  );

  // Lista exatamente quais campos obrigatórios estão pendentes (feedback visível)
  const camposPendentes = (f = form) => {
    const { pendentes } = validarFormulario(f);
    return pendentes;
  };

  const persistir = useCallback(async ({ silencioso = false, formOverride } = {}) => {
    const f = formOverride || form;
    const { valido, pendentes, primeiroId } = validarFormulario(f);
    if (!valido) {
      if (!silencioso) {
        setErro(`Preencha para salvar: ${pendentes.join(' • ')}.`);
        executarScrollParaElemento(primeiroId);
      }
      return null;
    }
    // Bloqueio de salvamento: KM Final menor que KM Inicial (isenta na preventiva).
    const msgKm = modoDoStatus(f.status_operacional) === 'preventiva'
      ? null
      : erroQuilometragemTexto(f.km_inicial, f.km_final);
    if (msgKm) {
      if (!silencioso) {
        setErro(msgKm);
        executarScrollParaElemento('campo-km-final');
      } else {
        setAutosave('erro');
      }
      return null;
    }
    if (!silencioso) { setErro(null); setSalvando(true); }
    else setAutosave('salvando');
    try {
      const payload = montarPayload(f);
      const url = parteId ? `/api/partes-diarias/${parteId}` : '/api/partes-diarias';
      const resp = await fetch(url, {
        method: parteId ? 'PUT' : 'POST',
        headers: authHeaders(sessao),
        body: JSON.stringify(payload),
      });
      const corpo = await resp.json().catch(() => ({}));
      // Regra de reaproveitamento: o backend recusou o duplicado (data+veículo
      // já lançados). Abre o registro existente para edição retroativa em vez
      // de apenas exibir o erro.
      if (!resp.ok && !parteId && corpo?.code === 'LIMITE_DIARIO_PARTE') {
        const encontrado = await buscarParteDoDia(payload.tag, payload.data);
        if (encontrado?.parte?.id && await carregarParteParaEdicao(encontrado.parte.id, { existente: true })) {
          return null;
        }
      }
      // Exibe o detalhe exato do banco/Prisma (campo `details` em dev) em vez do genérico
      if (!resp.ok) throw new Error(corpo.details || corpo.message || `Falha ao salvar (API ${resp.status})`);
      sujoRef.current = false;
      aplicarResposta(corpo.data);
      if (silencioso) {
        setAutosave(`salvo ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
      }
      return corpo.data;
    } catch (e) {
      console.error("Erro completo ao salvar:", e);
      const errorMsg = e.details || e.message || 'Falha ao salvar. Tente novamente.';
      if (silencioso) setAutosave('erro');
      else setErro(`Erro ao salvar: ${errorMsg}`);
      return null;
    } finally {
      if (!silencioso) setSalvando(false);
    }
  }, [form, parteId, montarPayload, aplicarResposta, sessao, validarFormulario, executarScrollParaElemento, buscarParteDoDia, carregarParteParaEdicao]);

  // Salvamento em tempo real: 1,5 s após a última edição (somente com id).
  useEffect(() => {
    if (!open || !parteId) return;
    if (pularAutosaveRef.current) { pularAutosaveRef.current = false; return; }
    if (!sujoRef.current) return;
    setAutosave('salvando');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { persistir({ silencioso: true }); }, 1500);
    return () => clearTimeout(timerRef.current);
  }, [form, open, parteId, persistir]);

  // ------- salvamento direto ("Salvar Relatório" grava sem modal intermediário) -------
  // Dispara validação com auto-scroll e destaque em caso de erro, e aciona o re-fetch no callback.
  const solicitarEnvio = async () => {
    if (salvando) return;
    const { valido, pendentes, primeiroId } = validarFormulario();
    if (!valido) {
      setErro(`Preencha para salvar: ${pendentes.join(' • ')}.`);
      executarScrollParaElemento(primeiroId);
      return;
    }
    setErro(null);
    clearTimeout(timerRef.current);
    const assinaturasLocais = [...(assinaturas || [])];
    const salvo = await persistir();
    if (salvo) {
      // Sincroniza assinaturas feitas antes do salvamento (modo local)
      const final = await sincronizarAssinaturasPendentes(salvo.id, assinaturasLocais);
      const resultadoFinal = final || salvo;
      if (final) {
        aplicarResposta(final);
        setForm((f) => ({ ...f, status_relatorio: final.status_relatorio || f.status_relatorio }));
      }
      notificarSucesso('Parte Diária salva com sucesso!', { salvo: resultadoFinal });
      return resultadoFinal;
    }
  };

  const handleSave = solicitarEnvio;
  const handleSubmit = solicitarEnvio;

  // ------- listas dinâmicas -------
  const adicionar = (chave, modelo) => {
    sujoRef.current = true;
    setForm((f) => ({ ...f, [chave]: [...(f[chave] || []), modelo] }));
  };

  // Função do colaborador: resolvida pelo cadastro (matrícula, depois nome).
  // Cai para a função do logado quando a linha é do próprio usuário.
  const resolverFuncao = (listaUsuarios, nome, matricula, ehDoLogado) => {
    const norm = (v) => String(v || '').trim().toUpperCase();
    const mat = norm(matricula);
    const nom = norm(nome);
    const achado = (listaUsuarios || []).find((u) =>
      (mat && norm(u.matricula) === mat) || (nom && norm(u.nome) === nom)
    );
    if (achado?.funcao) return achado.funcao;
    if (ehDoLogado) return funcaoDoLogado;
    return '';
  };

  // Diagnóstico da preventiva (conveniência — nunca bloqueia o formulário).
  // Em relatório preventivo a própria parte passa a ser a âncora do ciclo,
  // então ela não é ignorada na consulta (o marco zero atualiza na hora).
  const consultarManutencao = useCallback(async (tag, kmFinal, { ignorarParte = true } = {}) => {
    const t = String(tag || '').trim().toUpperCase();
    if (!t) { setManutencao(null); return; }
    const idReq = ++manutencaoReqRef.current;
    try {
      const qs = new URLSearchParams();
      if (String(kmFinal ?? '').trim() !== '' && Number.isFinite(Number(kmFinal))) {
        qs.set('km_atual', String(kmFinal));
      }
      if (parteId && ignorarParte) qs.set('ignorar_parte_id', parteId);
      const resp = await fetch(`/api/mob-desmob/${encodeURIComponent(t)}/status-manutencao?${qs}`, { headers: authHeaders(sessao) });
      if (!resp.ok) return;
      const corpo = await resp.json();
      if (manutencaoReqRef.current === idReq) setManutencao(corpo?.data || null);
    } catch {
      /* diagnóstico é conveniência: falha silenciosa */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao, parteId]);

  // Troca de veículo limpa o diagnóstico anterior.
  useEffect(() => { setManutencao(null); }, [tagPrincipal]);

  // Reconsulta ao trocar de veículo, de status ou digitar KM Final (debounce 600ms).
  useEffect(() => {
    if (!open || !tagPrincipal) return;
    const ignorarParte = modoDoStatus(form.status_operacional) !== 'preventiva';
    const timer = setTimeout(() => { consultarManutencao(tagPrincipal, form.km_final, { ignorarParte }); }, 600);
    return () => clearTimeout(timer);
  }, [open, tagPrincipal, form.km_final, form.status_operacional, parteId, consultarManutencao]);

  const fmtKm = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('pt-BR'));

  // Modal de seleção de equipamentos (frota ativa).
  const [modalEquip, setModalEquip] = useState(false);
  const [buscaEquip, setBuscaEquip] = useState('');

  // Modais de inserção: atividade (descrição + status) e ocorrência (tipo + descrição).
  const [modalAtiv, setModalAtiv] = useState(null); // { descricao, status }
  const [modalOcor, setModalOcor] = useState(null); // { tipo, descricao }

  const abrirModalAtiv = () => setModalAtiv({ descricao: '', status: '' });
  const abrirModalOcor = () => setModalOcor({ tipo: '', descricao: '' });

  const confirmarModalAtiv = () => {
    if (!modalAtiv || !modalAtiv.descricao.trim() || !modalAtiv.status) return;
    adicionar('atividades', { descricao: modalAtiv.descricao.trim(), status: modalAtiv.status });
    setModalAtiv(null);
  };

  const confirmarModalOcor = () => {
    if (!modalOcor || !modalOcor.tipo || !modalOcor.descricao.trim()) return;
    adicionar('ocorrencias', { tipo: modalOcor.tipo, descricao: modalOcor.descricao.trim() });
    setModalOcor(null);
  };

  const frotaAtiva = useMemo(() => {
    const norm = (v) => String(v || '').toUpperCase();
    const q = norm(buscaEquip);
    return (veiculos || [])
      .filter((v) => v?.tag && v.status !== 'Desmobilizado')
      .filter((v) => !q || norm(v.tag).includes(q) || norm(v.placa).includes(q) || norm(v.modelo).includes(q));
  }, [veiculos, buscaEquip]);

  const vincularEquipamento = (veiculo) => {
    if (!veiculo?.tag) return;
    sujoRef.current = true;
    limparErroCampo('equipamentos');
    // O 1º equipamento é o veículo principal (TAG do relatório).
    const ehPrincipal = (form.equipamentos || []).length === 0;
    const kmVazia = String(form.km_inicial ?? '').trim() === '';
    setForm((f) => ({
      ...f,
      equipamentos: [...(f.equipamentos || []), {
        tag_patrimonio: veiculo.tag,
        descricao: veiculo.modelo || veiculo.placa || '',
        horimetro_inicial: '',
        horimetro_final: '',
        status: 'Operacional',
      }],
    }));
    setModalEquip(false);
    setBuscaEquip('');
    // Gatilho da herança: veículo principal + KM Inicial vazia.
    if (ehPrincipal && kmVazia) herdarKmInicial(veiculo.tag);
  };

  // Herança automática do odômetro: preenche KM Inicial com a última
  // KM Final do veículo. Conveniência — nunca bloqueia o formulário.
  const herdarKmInicial = useCallback(async (tag) => {
    const t = String(tag || '').trim().toUpperCase();
    if (!t) return;
    try {
      const qs = new URLSearchParams({ tag: t });
      if (parteId) qs.set('ignorar_id', parteId);
      const resp = await fetch(`/api/partes-diarias/ultima-km?${qs}`, { headers: authHeaders(sessao) });
      if (!resp.ok) return;
      const corpo = await resp.json();
      const ultima = corpo?.data?.ultima_km_final;
      if (ultima === null || ultima === undefined) return;
      // Respeita valor digitado/enquanto isso (sem histórico prévio não herda).
      if (String(formRef.current?.km_inicial ?? '').trim() !== '') return;
      sujoRef.current = true;
      setForm((f) => (String(f.km_inicial ?? '').trim() !== '' ? f : { ...f, km_inicial: String(ultima) }));
      setKmHerdada(true);
      const d = corpo?.data?.data ? formatarDataSemTimezone(corpo.data.data) : null;
      const rel = corpo?.data?.numero_relatorio || null;
      setKmOrigem([d, rel].filter(Boolean).join(' • ') || null);
    } catch {
      /* herança é conveniência: falha silenciosa */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao, parteId]);

  const atualizarColaborador = (idx, campo, valor) => {
    if (idx === 0) return; // 1º registro (logado) é travado
    sujoRef.current = true;
    setForm((f) => ({
      ...f,
      mao_obra: (f.mao_obra || []).map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, [campo]: valor };
        const norm = (v) => String(v || '').trim().toUpperCase();
        const ehDoLogado = (usuario?.matricula && norm(next.matricula) === norm(usuario.matricula))
          || (usuario?.nome && norm(next.nome) === norm(usuario.nome));
        // Auxiliares sem função no cadastro assumem o cargo default "Sinaleiro"
        next.funcao = resolverFuncao(usuarios, next.nome, next.matricula, ehDoLogado) || next.funcao || 'Sinaleiro';
        return next;
      }),
    }));
  };
  const atualizarItem = (chave, idx, campo, valor) => {
    sujoRef.current = true;
    setForm((f) => ({
      ...f,
      [chave]: (f[chave] || []).map((it, i) => (i === idx ? { ...it, [campo]: valor } : it)),
    }));
  };
  const removerItem = (chave, idx) => {
    sujoRef.current = true;
    setForm((f) => ({ ...f, [chave]: (f[chave] || []).filter((_, i) => i !== idx) }));
  };

  // ------- fotos (upload integrado ao Cloudinary) -------
  const enviarFotos = async (arquivos) => {
    const lista = Array.from(arquivos || []).filter(Boolean);
    if (!lista.length) return;
    setUploading(true);
    setErro(null);
    try {
      for (const arq of lista) {
        const fd = new FormData();
        fd.append('arquivo', arq);
        const resp = await fetch('/api/upload?pasta=partes-diarias', { method: 'POST', body: fd });
        const corpo = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(corpo.message || `Falha no upload (${resp.status})`);
        const nova = { url: corpo.data.url, legenda: '', public_id: corpo.data.public_id || '' };
        const atualizadas = [...form.fotos, nova];
        // Atualiza o estado de forma síncrona para uploads em sequência.
        setForm((f) => ({ ...f, fotos: [...(f.fotos || []), nova] }));
        sujoRef.current = true;
        if (parteId) {
          await fetch(`/api/partes-diarias/${parteId}`, {
            method: 'PUT',
            headers: authHeaders(sessao),
            body: JSON.stringify({ fotos: atualizadas }),
          });
        }
      }
    } catch (e) {
      setErro(e.message || 'Falha ao enviar foto.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removerFoto = async (idx) => {
    const alvo = form.fotos[idx];
    removerItem('fotos', idx);
    if (parteId) {
      const restantes = form.fotos.filter((_, i) => i !== idx);
      await fetch(`/api/partes-diarias/${parteId}`, {
        method: 'PUT',
        headers: authHeaders(sessao),
        body: JSON.stringify({ fotos: restantes }),
      }).catch(() => { });
    }
    // Tenta liberar o asset na nuvem (falha isolada não trava a UI).
    if (alvo?.public_id) {
      fetch('/api/upload', {
        method: 'DELETE',
        headers: authHeaders(sessao),
        body: JSON.stringify({ public_id: alvo.public_id }),
      }).catch(() => { });
    }
  };

  // ------- assinaturas (3 etapas) — modal de dupla opção -------
  const [modalAssin, setModalAssin] = useState(null); // { etapa, rotulo } | null
  const [assinando, setAssinando] = useState(false);

  // Retorna a imagem da assinatura (compat: assinatura_dado novo / assinatura_url legado)
  const imagemAssinatura = (a) => a?.assinatura_dado || a?.assinatura_url || null;

  // Liberação total: qualquer papel pode assinar qualquer etapa, com ou sem
  // relatório salvo. Sem trava de papel e sem exigir salvamento prévio.
  // Quando ainda não há parteId, a assinatura fica em estado local e é
  // sincronizada com o backend no momento do salvamento (solicitarEnvio).
  const statusRelatorioParaEtapa = (etapa, listaAtual = assinaturas) => {
    const etapas = new Set((listaAtual || []).map((a) => String(a.etapa || '').toUpperCase()));
    etapas.add(String(etapa || '').toUpperCase());
    if (ehOnibus) return etapas.has('TRANSPORTE') ? 'APROVADO' : 'REVISAO';
    return etapas.has('PLANEJADOR') ? 'APROVADO' : 'REVISAO';
  };

  const statusRelatorioAposRemocao = (restantes) => {
    const etapas = new Set((restantes || []).map((a) => String(a.etapa || '').toUpperCase()));
    if (ehOnibus) {
      if (etapas.has('TRANSPORTE')) return 'APROVADO';
      if (etapas.has('OPERADOR')) return 'REVISAO';
      return 'PREENCHENDO';
    }
    if (etapas.has('PLANEJADOR')) return 'APROVADO';
    if (etapas.has('TRANSPORTE') || etapas.has('OPERADOR')) return 'REVISAO';
    return 'PREENCHENDO';
  };

  const abrirModalAssin = (etapa, rotulo) => {
    setErro(null);
    setModalAssin({ etapa, rotulo });
  };

  // Sincroniza assinaturas locais (pré-salvamento) com o backend após criar o relatório
  const sincronizarAssinaturasPendentes = async (relatorioId, lista) => {
    const pendentes = (lista || []).filter((a) => a && a.__local && String(a.etapa || '').trim());
    if (!relatorioId || pendentes.length === 0) return null;
    let ultimo = null;
    for (const a of pendentes) {
      try {
        const resp = await fetch(`/api/partes-diarias/${relatorioId}/assinaturas`, {
          method: 'POST',
          headers: authHeaders(sessao),
          body: JSON.stringify({
            etapa: String(a.etapa).toUpperCase(),
            nome: a.nome,
            matricula: a.matricula || undefined,
            assinatura_dado: imagemAssinatura(a),
            assinatura_url: imagemAssinatura(a),
          }),
        });
        const corpo = await resp.json().catch(() => ({}));
        if (resp.ok && corpo.data) ultimo = corpo.data;
      } catch { /* segue para a próxima etapa */ }
    }
    return ultimo;
  };

  // Chamado pelo ModalAssinaturaDigital ao confirmar
  const confirmarAssinatura = async ({ modo, dataUrl, salvarNoPerfil }) => {
    if (!modalAssin) return;
    const { etapa } = modalAssin;
    const etapaNorm = String(etapa).toUpperCase();
    setAssinando(true);
    setErro(null);
    try {
      // 1. Desenho ou foto + salvar no perfil → persiste a assinatura padrão primeiro
      if ((modo === 'canvas' || modo === 'foto') && dataUrl && salvarNoPerfil) {
        const respPerfil = await fetch('/api/usuarios/minha-assinatura', {
          method: 'PUT',
          headers: authHeaders(sessao),
          body: JSON.stringify({ assinatura_base64: dataUrl }),
        });
        const corpoPerfil = await respPerfil.json().catch(() => ({}));
        if (!respPerfil.ok) {
          throw new Error(corpoPerfil.message || `Falha ao salvar a assinatura no perfil (${respPerfil.status}).`);
        }
      }
      // 2. Imagem + responsável da assinatura
      // Compat: backend lê `assinatura_dado`; mantemos `assinatura_url` como alias
      const imagemFinal = dataUrl
        || (modo === 'cadastrada' ? (usuario?.assinatura_padrao || usuario?.assinatura_url || null) : null);
      const nomeFinal = String(nomesAssinatura[etapaNorm] || nomesAssinatura[etapa] || usuario?.nome || '').trim() || usuario?.nome || 'Usuário';
      const matriculaFinal = usuario?.matricula || null;

      // 3a. Sem relatório salvo → assinatura local (atualiza card + badge na hora)
      if (!parteId) {
        const nova = {
          etapa: etapaNorm,
          nome: nomeFinal,
          matricula: matriculaFinal,
          assinatura_dado: imagemFinal,
          assinatura_url: imagemFinal,
          assinado_em: new Date().toISOString(),
          __local: true,
        };
        setAssinaturas((prev) => ([
          ...(prev || []).filter((a) => String(a.etapa).toUpperCase() !== etapaNorm),
          nova,
        ]));
        setForm((f) => ({ ...f, status_relatorio: statusRelatorioParaEtapa(etapaNorm) }));
        sujoRef.current = true;
        setModalAssin(null);
        notificarSucesso(`Etapa ${etapaNorm} assinada!`, { manterAberto: true });
        return;
      }

      // 3b. Com relatório salvo → persiste direto no backend
      const payload = {
        etapa: etapaNorm,
        nome: nomeFinal,
        matricula: matriculaFinal || undefined,
        assinatura_dado: imagemFinal,
        assinatura_url: imagemFinal,
        assinatura_base64: (modo === 'canvas' || modo === 'foto') ? (dataUrl || null) : undefined,
      };
      const resp = await fetch(`/api/partes-diarias/${parteId}/assinaturas`, {
        method: 'POST',
        headers: authHeaders(sessao),
        body: JSON.stringify(payload),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.details || corpo.message || `Falha ao assinar (${resp.status})`);
      aplicarResposta(corpo.data);
      setForm((f) => ({ ...f, status_relatorio: corpo.data.status_relatorio || f.status_relatorio }));
      setModalAssin(null);
      notificarSucesso(`Etapa ${etapaNorm} assinada!`, { manterAberto: true, salvo: corpo.data });
    } catch (e) {
      console.error("Erro completo ao salvar:", e);
      setErro(`Erro ao salvar: ${e.details || e.message || 'Falha ao assinar.'}`);
    } finally {
      setAssinando(false);
    }
  };

  const removerAssinatura = async (etapa) => {
    const etapaNorm = String(etapa || '').toUpperCase();
    // Sem id ou assinatura ainda local → remove só do estado
    if (!parteId) {
      setAssinaturas((prev) => {
        const restantes = (prev || []).filter((a) => String(a.etapa).toUpperCase() !== etapaNorm);
        setForm((f) => ({ ...f, status_relatorio: statusRelatorioAposRemocao(restantes) }));
        return restantes;
      });
      return;
    }
    try {
      const resp = await fetch(`/api/partes-diarias/${parteId}/assinaturas/${etapaNorm}`, {
        method: 'DELETE',
        headers: authHeaders(sessao),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.details || corpo.message || 'Falha ao remover assinatura.');
      aplicarResposta(corpo.data);
      setForm((f) => ({ ...f, status_relatorio: corpo.data.status_relatorio || f.status_relatorio }));
    } catch (e) {
      console.error("Erro completo ao salvar:", e);
      // Se o backend falhar (ex.: assinatura era local), remove do estado
      setAssinaturas((prev) => (prev || []).filter((a) => String(a.etapa).toUpperCase() !== etapaNorm));
      setErro(`Erro ao salvar: ${e.details || e.message || 'Falha ao remover assinatura.'}`);
    }
  };

  const assinaturaDe = (etapa) => (assinaturas || []).find((a) => String(a.etapa).toUpperCase() === etapa);

  const rotuloStatus = useMemo(
    () => STATUS_RELATORIO.find((s) => s.valor === form.status_relatorio)?.rotulo || form.status_relatorio,
    [form.status_relatorio]
  );

  // Status de aprovação baseado nas assinaturas presentes
  const chaveAprovacao = useMemo(
    () => resolverStatusAprovacao(form.status_relatorio, assinaturas, ehOnibus),
    [form.status_relatorio, assinaturas, ehOnibus]
  );
  const infoAprovacao = STATUS_APROVACAO[chaveAprovacao] || STATUS_APROVACAO.EM_PREENCHIMENTO;

  const fechar = () => {
    if (salvando || uploading) return;
    clearTimeout(timerRef.current);
    onClose?.();
  };

  const inputCls = 'input !py-1.5 text-sm';
  const btnIcone = 'p-1.5 rounded-md hover:bg-red-50 text-omega-400 hover:text-status-vermelho transition-colors';
  // Modo de segregação do formulário (recalculado a cada render).
  const modo = modoDoStatus(form.status_operacional);
  const corStatusOperacional = CORES_STATUS_OPERACIONAL[form.status_operacional] || '';
  const statusInvalido = errosValidacao.status_operacional || !STATUS_OPERACIONAL_DIA.includes(form.status_operacional);
  const corSetaStatus = statusInvalido ? 'text-red-500' : corStatusOperacional ? 'text-white' : 'text-omega-500';

  return (
    <>
      <Modal
        open={open}
        onClose={fechar}
        title={parteExistente ? 'Editar Parte Diária' : 'Parte Diária'}
        subtitle={parteId ? `${(form.equipamentos || []).find((e) => String(e.tag_patrimonio || '').trim())?.tag_patrimonio || 'Relatório'} • ${form.obra || ''} • ${rotuloStatus}` : 'Novo relatório • preencha e salve'}
        size="full"
        footer={
          <>
            <span className="mr-auto text-xs text-omega-400 hidden sm:block">
              {autosave === 'salvando' && 'Salvando automaticamente...'}
              {typeof autosave === 'string' && autosave.startsWith('salvo') && `Salvo automaticamente às ${autosave.slice(6)}`}
              {autosave === 'erro' && 'Falha no salvamento automático — use Salvar Relatório.'}
            </span>
            <button onClick={fechar} disabled={salvando} className="btn-secondary disabled:opacity-50">Fechar</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={salvando || carregando}
              className="btn-primary disabled:opacity-50"
            >
              {salvando ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : <><Save size={15} /> Salvar Relatório</>}
            </button>
          </>
        }
      >
        {carregando ? (
          <div className="flex items-center justify-center p-10 text-omega-500 text-sm font-semibold">
            <Loader2 size={20} className="animate-spin mr-2" /> Carregando relatório...
          </div>
        ) : (
          <div className="space-y-4">
            {erro && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200/60 text-sm text-red-800 flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>{erro}</span>
              </div>
            )}

            {parteExistente && (
              <div className="p-3 rounded-xl bg-sky-50 border border-sky-200/70 text-sm text-sky-900 flex items-start gap-2">
                <History size={16} className="mt-0.5 shrink-0 text-sky-700" />
                <div>
                  <p className="font-bold">
                    {parteExistente.tag || 'Este veículo'} já possui uma Parte Diária em {formatarDataSemTimezone(parteExistente.data)}.
                  </p>
                  <p className="mt-0.5 text-[12px] text-sky-800">
                    Você está editando o lançamento existente
                    {parteExistente.numero_relatorio ? ` (Nº ${parteExistente.numero_relatorio})` : ''}.
                    Salve para atualizar o registro retroativo — nenhuma duplicidade será criada.
                  </p>
                </div>
              </div>
            )}

            {/* 1. CABEÇALHO / DETALHES DO RELATÓRIO */}
            <div className="card overflow-hidden">
              <div className="px-4 pt-4 pb-3 text-center border-b border-omega-100 bg-omega-50/40">
                <div className="inline-flex items-center gap-2">
                  <span className="w-9 h-9 rounded-xl bg-omega-900 text-white flex items-center justify-center text-lg font-black">Ω</span>
                  <span className="text-left leading-tight">
                    <span className="block text-[11px] font-extrabold tracking-widest text-omega-900">OMEGA SERVICE</span>
                    <span className="block text-[10px] text-omega-400 font-medium">Gestão de Transporte</span>
                  </span>
                </div>
                <h3 className="mt-2 text-base font-extrabold text-omega-900">Parte Diária</h3>
                <p className="text-[11px] text-omega-400">{diaSemanaDe(form.data)}</p>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="label">Data <span className="text-status-vermelho">*</span></label>
                  <input
                    id="campo-data"
                    type="date"
                    value={form.data}
                    onChange={(e) => {
                      limparErroCampo('data');
                      definirData(e.target.value);
                    }}
                    disabled={dataTravada}
                    title={dataTravada ? 'Data travada pelo lançamento retroativo da auditoria de pendências' : undefined}
                    className={`${inputCls} ${
                      errosValidacao.data || erroData
                        ? '!border-red-500 ring-2 ring-red-500/50 bg-red-50/40 animate-pulse'
                        : ''
                    } ${dataTravada ? 'bg-omega-50 text-omega-500 cursor-not-allowed' : ''}`}
                  />
                  {dataTravada && (
                    <p className="mt-1 text-[11px] font-semibold text-sky-700 flex items-center gap-1">
                      <AlertTriangle size={12} className="shrink-0" />
                      Data travada: lançamento retroativo do dia pendente na auditoria.
                    </p>
                  )}
                  {(errosValidacao.data || erroData) && (
                    <p className="mt-1 text-[11px] font-semibold text-red-600 flex items-center gap-1">
                      <AlertTriangle size={12} className="shrink-0" />
                      {errosValidacao.data || erroData}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">Dia da Semana</label>
                  <input value={diaSemanaDe(form.data)} readOnly className={`${inputCls} bg-omega-50 text-omega-500`} />
                </div>
                <div>
                  <label className="label">Status Operacional do Dia <span className="text-status-vermelho">*</span></label>
                  <div className="relative">
                    <select
                      id="campo-status-operacional"
                      value={form.status_operacional || ''}
                      onChange={(e) => definirStatusOperacional(e.target.value)}
                      className={`${inputCls} appearance-none pr-9 font-bold transition-colors ${corStatusOperacional} ${
                        statusInvalido
                          ? '!border-red-500 ring-2 ring-red-500/50 !bg-red-50/60 !text-red-700 animate-pulse'
                          : ''
                      } ${statusTravado ? 'opacity-100 cursor-not-allowed' : ''}`}
                      required
                      disabled={statusTravado}
                      title={statusTravado ? 'Fixado em Operação para o seu perfil' : 'Situação operacional da frente de serviço no dia'}
                    >
                      {!statusTravado && <option value="" className="bg-white font-semibold text-omega-900">Selecionar status...</option>}
                      {(statusTravado ? ['Operação'] : STATUS_OPERACIONAL_DIA).map((s) => (
                        <option key={s} value={s} className="bg-white font-semibold text-omega-900">{ROTULOS_STATUS_OPERACIONAL[s] || s}</option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      aria-hidden="true"
                      className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 ${corSetaStatus}`}
                    />
                  </div>
                  {statusTravado && (
                    <p className="mt-1 text-[11px] text-omega-400">Fixado em Operação para o seu perfil.</p>
                  )}
                  {errosValidacao.status_operacional && (
                    <p className="mt-1 text-[11px] font-semibold text-red-600 flex items-center gap-1">
                      <AlertTriangle size={12} className="shrink-0" />
                      {errosValidacao.status_operacional}
                    </p>
                  )}
                  {(modo === 'preventiva' || modo === 'parada') && (
                    <p className="mt-1 text-[11px] font-semibold text-omega-600">
                      {modo === 'preventiva'
                        ? 'Modo revisão: preencha só obra, veículo e KM de preventiva.'
                        : 'Modo frota parada: preencha só obra, data, veículo e o motivo.'}
                    </p>
                  )}
                </div>
                {modo === 'operacao' && (
                <>
                <div className={`rounded-xl border-2 p-2.5 shadow-sm transition-colors ${
                  errosValidacao.obra
                    ? 'border-red-400 bg-red-50/40 shadow-red-500/10'
                    : 'border-sky-500/60 bg-sky-50/60 shadow-sky-500/10'
                }`}>
                  <label className="label !font-extrabold !text-sky-800 flex items-center gap-1.5">
                    <Building2 size={13} className="shrink-0" />
                    Obra <span className="text-status-vermelho">*</span>
                  </label>
                  <select
                    id="campo-obra"
                    value={form.obra_id || (form.obra ? '__legado__' : '')}
                    onChange={(e) => {
                      limparErroCampo('obra');
                      selecionarObra(e.target.value);
                    }}
                    className={`${inputCls} !bg-white/90 font-semibold ${
                      errosValidacao.obra
                        ? '!border-red-500 ring-2 ring-red-500/50 bg-red-50/40 animate-pulse'
                        : '!border-sky-500/60 focus:ring-sky-500/20'
                    }`}
                    title="Obras ativas do cadastro — preenche contrato, contratante, gestão e planejador"
                  >
                    <option value="">Selecionar obra...</option>
                    {obras.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nome}{o.numeroContrato ? ` • ${o.numeroContrato}` : ''}
                      </option>
                    ))}
                    {/* Compatibilidade: obra textual de lançamentos antigos fora do cadastro */}
                    {form.obra && !obras.some((o) => o.id === form.obra_id || o.nome === form.obra) && (
                      <option value="__legado__">{form.obra} (cadastro anterior)</option>
                    )}
                  </select>
                  {errosValidacao.obra && (
                    <p className="mt-1 text-[11px] font-semibold text-red-600 flex items-center gap-1">
                      <AlertTriangle size={12} className="shrink-0" />
                      {errosValidacao.obra}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-omega-400">Ao selecionar, contrato, contratante, gestão e planejador são preenchidos automaticamente.</p>
                </div>
                <div>
                  <label className="label">Contratante</label>
                  <input value={form.contratante} readOnly title="Preenchido automaticamente pela obra selecionada" className={`${inputCls} bg-omega-50 text-omega-500`} placeholder="Ex: Vale" />
                </div>
                <div>
                  <label className="label">Responsável</label>
                  <input value={form.responsavel} readOnly title="Preenchido automaticamente pela obra selecionada" className={`${inputCls} bg-omega-50 text-omega-500`} placeholder="Ex: Denilson Silva" />
                </div>
                <div>
                  <label className="label">Planejador</label>
                  <input value={form.planejador} readOnly title="Preenchido automaticamente pela obra selecionada" className={`${inputCls} bg-omega-50 text-omega-500`} placeholder="Preenchido pela obra" />
                </div>
                </>
                )}
              </div>
            </div>

            {/* 2. HORÁRIO DE TRABALHO (só operação) */}
            {modo === 'operacao' && (
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="p-1.5 rounded-lg bg-omega-900 text-white"><Clock size={14} /></span>
                <span className="text-sm font-bold text-omega-900">Horário de Trabalho</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="min-w-0">
                  <label className="label">Entrada (Jornada)</label>
                  <input type="time" value={form.horario_entrada} onChange={(e) => definir('horario_entrada', e.target.value)} className={`${inputCls} tabular-nums`} />
                </div>
                <div className="min-w-0">
                  <label className="label">Saída (Jornada)</label>
                  <input type="time" value={form.horario_saida} onChange={(e) => definir('horario_saida', e.target.value)} className={`${inputCls} tabular-nums`} />
                </div>
                <div className="min-w-0">
                  <label className="label">Intervalo Entrada</label>
                  <input type="time" value={form.intervalo_entrada} onChange={(e) => definir('intervalo_entrada', e.target.value)} className={`${inputCls} tabular-nums`} />
                </div>
                <div className="min-w-0">
                  <label className="label">Intervalo Saída</label>
                  <input type="time" value={form.intervalo_saida} onChange={(e) => definir('intervalo_saida', e.target.value)} className={`${inputCls} tabular-nums`} />
                </div>
              </div>
            </div>
            )}

            {/* 3. MÃO DE OBRA (só operação) */}
            {modo === 'operacao' && (
            <Secao icone={Users} titulo="Mão de Obra" count={form.mao_obra.length} aberto={secoes.mao} onToggle={() => alternarSecao('mao')} onAdicionar={() => adicionar('mao_obra', { nome: '', matricula: '', funcao: 'Sinaleiro' })}>
              {form.mao_obra.length === 0 && <LinhaVazia texto="Nenhum colaborador lançado. Use + Adicionar." />}
              {form.mao_obra.length > 0 && (
                <p className="text-[11px] text-omega-400 -mb-1">O primeiro registro é o operador autor do lançamento (travado). Use + Adicionar para auxiliares. A função é preenchida pelo cadastro.</p>
              )}
              <datalist id="mao-matriculas">
                {usuarios.map((u) => (
                  <option key={u.id} value={u.matricula}>{`${u.nome}${u.funcao ? ` • ${u.funcao}` : ''}`}</option>
                ))}
              </datalist>
              <datalist id="mao-nomes">
                {usuarios.map((u) => (
                  <option key={u.id} value={u.nome}>{`${u.matricula}${u.funcao ? ` • ${u.funcao}` : ''}`}</option>
                ))}
              </datalist>
              {form.mao_obra.map((it, i) => {
                const travado = i === 0;
                const val = (f, fb) => (travado ? (f || fb || '') : (f ?? ''));
                return (
                  <div key={i} className={`grid grid-cols-1 md:grid-cols-12 gap-2 p-2.5 rounded-xl border ${travado ? 'border-omega-900/20 bg-omega-900/[0.03]' : 'border-omega-100 bg-omega-50/40'}`}>
                    <input
                      value={val(it.matricula, '')}
                      onChange={(e) => atualizarColaborador(i, 'matricula', e.target.value)}
                      readOnly={travado}
                      title={travado ? 'Operador autor (travado)' : undefined}
                      className={`${inputCls} w-full md:col-span-3 font-mono ${travado ? 'bg-omega-50 text-omega-500' : ''}`}
                      placeholder="Matrícula *"
                      list={travado ? undefined : 'mao-matriculas'}
                    />
                    <input
                      value={val(it.nome, '')}
                      onChange={(e) => atualizarColaborador(i, 'nome', e.target.value)}
                      readOnly={travado}
                      title={travado ? 'Operador autor (travado)' : undefined}
                      className={`${inputCls} w-full font-medium md:col-span-4 ${travado ? 'bg-omega-50 text-omega-500' : 'text-omega-900'}`}
                      placeholder="Nome *"
                      list={travado ? undefined : 'mao-nomes'}
                    />
                    <input
                      value={val(it.funcao, '')}
                      readOnly
                      title={travado ? 'Função do operador autor' : 'Preenchida automaticamente pelo cadastro do colaborador'}
                      className={`${inputCls} w-full md:col-span-4 bg-omega-50 text-omega-500`}
                      placeholder="Função (automática)"
                    />
                    <div className="md:col-span-1 flex md:justify-end">
                      {!travado && <button onClick={() => removerItem('mao_obra', i)} className={btnIcone} title="Remover"><Trash2 size={15} /></button>}
                    </div>
                  </div>
                );
              })}
            </Secao>
            )}

            {/* 4. EQUIPAMENTOS */}
            <div id="campo-equipamentos" className={`rounded-2xl transition-all ${errosValidacao.equipamentos ? 'ring-2 ring-red-500/70 p-0.5' : ''}`}>
              <Secao
                icone={Truck}
                titulo="Equipamentos (Veículo Obrigatório)"
                count={form.equipamentos.length}
                aberto={secoes.equip}
                onToggle={() => alternarSecao('equip')}
                onAdicionar={() => { setBuscaEquip(''); setModalEquip(true); }}
                temErro={!!errosValidacao.equipamentos}
              >
                {errosValidacao.equipamentos && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 flex items-center gap-2 animate-pulse">
                    <AlertTriangle size={15} className="shrink-0 text-red-600" />
                    <span>{errosValidacao.equipamentos}</span>
                    <button
                      type="button"
                      onClick={() => { setBuscaEquip(''); setModalEquip(true); }}
                      className="ml-auto btn-primary !py-1 !px-2.5 text-xs shrink-0"
                    >
                      <Plus size={13} /> Escolher da Frota
                    </button>
                  </div>
                )}
                {form.equipamentos.length === 0 && <LinhaVazia texto="Nenhum veículo/equipamento lançado. Use + Adicionar para escolher da frota." />}
                {form.equipamentos.map((it, i) => {
                  const norm = (v) => String(v || '').trim().toUpperCase();
                  const ficha = (veiculos || []).find((v) => norm(v.tag) === norm(it.tag_patrimonio));
                  const identificacao = [
                    it.tag_patrimonio || '—',
                    ficha?.placa,
                    it.descricao || ficha?.modelo,
                  ].filter(Boolean).join(' • ');
                  // Retroativo: o veiculo do dia pendente (1º equipamento) fica travado.
                  const equipamentoTravado = !!tagTravada && i === 0 && norm(it.tag_patrimonio) === tagTravada;
                  return (
                    <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-2.5 rounded-xl border border-omega-100 bg-omega-50/40">
                      <div className="flex items-center gap-3 min-w-0 w-full">
                        <span className="w-9 h-9 rounded-xl bg-omega-900 text-white flex items-center justify-center shrink-0">
                          <Truck size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono font-extrabold text-omega-900 text-sm break-words">{identificacao}</span>
                          {ficha?.status && <span className="block text-[11px] text-omega-400">{ficha.status}</span>}
                          {equipamentoTravado && <span className="block text-[11px] text-sky-700 font-semibold">Veículo travado pelo lançamento retroativo</span>}
                        </span>
                      </div>
                      {!equipamentoTravado && (
                        <button onClick={() => removerItem('equipamentos', i)} className={`${btnIcone} self-end sm:self-center sm:ml-auto shrink-0`} title="Remover"><Trash2 size={15} /></button>
                      )}
                    </div>
                  );
                })}
              </Secao>
            </div>

            {/* 5. QUILOMETRAGEM (operação + preventiva) */}
            {(modo === 'operacao' || modo === 'preventiva') && (
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="p-1.5 rounded-lg bg-omega-900 text-white"><Gauge size={14} /></span>
                <span className="text-sm font-bold text-omega-900">Quilometragem</span>
              </div>
              {modo === 'preventiva' ? (
                <div className="mb-3 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2.5 text-xs font-semibold text-sky-800">
                  ℹ️ Registrando Manutenção Preventiva: A KM informada atualizará o marco zero do ciclo.
                </div>
              ) : (
              <>
              {manutencao?.status_alerta === 'PROXIMO' && (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800">
                  ⚠️ Atenção: Este veículo está a {fmtKm(manutencao.km_restantes_para_preventiva)} km da próxima Manutenção Preventiva.
                  <span className="block mt-0.5 font-normal text-amber-700">
                    Rodados desde a preventiva: {fmtKm(manutencao.km_rodados_desde_preventiva)} km • Limite: {fmtKm(manutencao.km_limite_preventiva)} km
                  </span>
                </div>
              )}
              {manutencao?.status_alerta === 'VENCIDO' && (
                <div className="mb-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">
                  🚨 Alerta de Manutenção: Este veículo atingiu o limite para Preventiva! É necessário registrar a revisão.
                  <span className="block mt-0.5 font-normal text-red-600">
                    Excesso de {fmtKm(Math.abs(manutencao.km_restantes_para_preventiva))} km • Limite: {fmtKm(manutencao.km_limite_preventiva)} km
                  </span>
                  {!statusTravado && form.status_operacional !== 'Manutenção Preventiva' && (
                    <button
                      onClick={() => definirStatusOperacional('Manutenção Preventiva')}
                      className="btn-secondary !py-1.5 !px-2.5 text-xs mt-2"
                    >
                      Usar status “Manutenção Preventiva”
                    </button>
                  )}
                </div>
              )}
              </>
              )}
              <div className="grid grid-cols-2 gap-3">
                {modo !== 'preventiva' && (
                <div>
                  <label className="label">KM Inicial</label>
                  <input type="number" min="0" value={form.km_inicial} onChange={(e) => definirKmInicial(e.target.value)} className={`${inputCls} tabular-nums`} placeholder="0" />
                  {kmHerdada && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-omega-600">
                      <History size={11} className="shrink-0" />
                      <span className="truncate">Herdado do registro anterior{kmOrigem ? ` • ${kmOrigem}` : ''}</span>
                    </p>
                  )}
                </div>
                )}
                <div className={modo === 'preventiva' ? 'col-span-2' : ''}>
                  <label className="label">{modo === 'preventiva' ? 'KM da Preventiva *' : 'KM Final'}</label>
                  <input
                    id="campo-km-final"
                    type="number"
                    min="0"
                    value={form.km_final}
                    onChange={(e) => {
                      limparErroCampo('km_final');
                      definir('km_final', e.target.value);
                    }}
                    className={`${inputCls} tabular-nums ${
                      errosValidacao.km_final || erroKm
                        ? '!border-red-500 ring-2 ring-red-500/50 bg-red-50/40 animate-pulse'
                        : ''
                    }`}
                    placeholder="0"
                  />
                  {(errosValidacao.km_final || erroKm) && (
                    <p className="mt-1 text-[11px] font-semibold text-red-600 flex items-center gap-1">
                      <AlertTriangle size={12} className="shrink-0" />
                      {errosValidacao.km_final || erroKm}
                    </p>
                  )}
                  {!erroKm && !errosValidacao.km_final && modo === 'preventiva' && (
                    <p className="mt-1 text-[11px] text-omega-500">Zera o ciclo e vira a nova âncora da preventiva.</p>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* MOTIVO DA PARADA (só frota parada) */}
            {modo === 'parada' && (
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="p-1.5 rounded-lg bg-omega-900 text-white"><AlertTriangle size={14} /></span>
                <span className="text-sm font-bold text-omega-900">Motivo da Parada</span>
              </div>
              <label className="label">Observação <span className="text-omega-400 font-normal">(opcional)</span></label>
              <textarea
                value={motivoParada}
                onChange={(e) => { sujoRef.current = true; setMotivoParada(e.target.value); }}
                className={`${inputCls} min-h-[88px] resize-y`}
                placeholder="Ex: Aguardando peça do freio — previsão de retorno em 2 dias."
              />
            </div>
            )}

            {/* 6. OCORRÊNCIA (só operação) */}
            {modo === 'operacao' && (
            <>
            <div className="pt-1">
              <h5 className="text-sm font-extrabold text-omega-900">Ocorrência</h5>
              <p className="text-[11px] text-omega-400">Atividades executadas e ocorrências registradas no dia</p>
            </div>
            <Secao icone={ClipboardList} titulo="Atividades" count={form.atividades.length} aberto={secoes.ativ} onToggle={() => alternarSecao('ativ')} onAdicionar={abrirModalAtiv}>
              {form.atividades.length === 0 && <LinhaVazia texto="Nenhuma atividade lançada. Use + Adicionar." />}
              {form.atividades.map((it, i) => (
                <div key={i} className="flex flex-col md:flex-row md:items-center gap-2 p-2.5 rounded-xl border border-omega-100 bg-omega-50/40">
                  <input value={it.descricao} onChange={(e) => atualizarItem('atividades', i, 'descricao', e.target.value)} className={`${inputCls} flex-1 min-w-0`} placeholder="Descrição da atividade *" />
                  <span className={`chip shrink-0 ring-1 ring-inset ${COR_STATUS_ATIV[it.status] || 'bg-omega-100 text-omega-600 ring-omega-700/10'}`}>
                    {it.status || 'Sem status'}
                  </span>
                  <select value={it.status} onChange={(e) => atualizarItem('atividades', i, 'status', e.target.value)} className={`${inputCls} md:w-40`} title="Status">
                    {STATUS_ATIVIDADE.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={() => removerItem('atividades', i)} className={`${btnIcone} self-end md:self-center`} title="Remover"><Trash2 size={15} /></button>
                </div>
              ))}
            </Secao>

            <Secao icone={AlertTriangle} titulo="Ocorrências" count={form.ocorrencias.length} aberto={secoes.ocor} onToggle={() => alternarSecao('ocor')} onAdicionar={abrirModalOcor}>
              {form.ocorrencias.length === 0 && <LinhaVazia texto="Nenhuma ocorrência registrada. Use + Adicionar." />}
              {form.ocorrencias.map((it, i) => (
                <div key={i} className="flex flex-col md:flex-row gap-2 p-2.5 rounded-xl border border-omega-100 bg-omega-50/40">
                  <select value={it.tipo} onChange={(e) => atualizarItem('ocorrencias', i, 'tipo', e.target.value)} className={`${inputCls} md:w-44`} title="Tipo">
                    {TIPOS_OCORRENCIA.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input value={it.descricao} onChange={(e) => atualizarItem('ocorrencias', i, 'descricao', e.target.value)} className={`${inputCls} flex-1 min-w-0`} placeholder="Descrição *" />
                  <button onClick={() => removerItem('ocorrencias', i)} className={`${btnIcone} self-end md:self-center`} title="Remover"><Trash2 size={15} /></button>
                </div>
              ))}
            </Secao>
            </>
            )}

            {modo === 'operacao' && (
            <Secao icone={Camera} titulo="Fotos" count={form.fotos.length} aberto={secoes.fotos} onToggle={() => alternarSecao('fotos')} onAdicionar={() => fileRef.current?.click()} labelAdicionar="Enviar foto">
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => enviarFotos(e.target.files)} />
              {uploading && (
                <div className="flex items-center gap-2 text-xs font-semibold text-omega-500">
                  <Loader2 size={14} className="animate-spin" /> Enviando para a nuvem (Cloudinary)...
                </div>
              )}
              {form.fotos.length === 0 && !uploading && <LinhaVazia texto="Nenhuma foto anexada. Use Enviar foto." />}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {form.fotos.map((f, i) => (
                  <div key={i} className="rounded-xl border border-omega-100 overflow-hidden bg-omega-50/40">
                    <a href={f.url} target="_blank" rel="noreferrer" className="block aspect-video bg-omega-100 overflow-hidden">
                      <img src={f.url} alt={f.legenda || `Foto ${i + 1}`} className="w-full h-full object-cover hover:scale-105 transition-transform" loading="lazy" />
                    </a>
                    <div className="p-2 flex items-center gap-1">
                      <input value={f.legenda} onChange={(e) => atualizarItem('fotos', i, 'legenda', e.target.value)} className="input !py-1 !px-2 text-xs flex-1 min-w-0" placeholder="Legenda" />
                      <button onClick={() => removerFoto(i)} className={btnIcone} title="Remover foto"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-secondary !py-2 text-xs w-full justify-center disabled:opacity-50">
                <Upload size={14} /> {uploading ? 'Enviando...' : 'Enviar foto (Cloudinary)'}
              </button>
            </Secao>
            )}

            {/* 7. ASSINATURAS (só operação) */}
            {modo === 'operacao' && (
            <div className="card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-omega-900 text-white"><PenLine size={14} /></span>
                  <span className="text-sm font-bold text-omega-900">Assinaturas – Fluxo de Aprovação</span>
                  {ehOnibus && (
                    <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-sky-800 ring-1 ring-inset ring-sky-300">
                      Ônibus • 2 etapas
                    </span>
                  )}
                </div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold ring-1 ring-inset ${infoAprovacao.cor.bg} ${infoAprovacao.cor.text} ${infoAprovacao.cor.ring}`}>
                  {infoAprovacao.rotulo}
                </span>
              </div>
              {ehOnibus && (
                <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-800">
                  Fluxo de ônibus: Operador + Transporte. A aprovação é automática após a assinatura do Transporte.
                </p>
              )}
              {/* Grid das etapas: 2 para ônibus, 3 no fluxo padrão */}
              <div className={`grid grid-cols-1 gap-3 ${etapasAssinatura.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
                {etapasAssinatura.map((et) => {
                  const a = assinaturaDe(et.valor);
                  const COR_ETAPA_CARD = {
                    OPERADOR: { border: 'border-amber-200', bg: 'bg-amber-50/60', badge: 'bg-amber-50 text-amber-800 ring-amber-300', dot: 'bg-amber-400', btnCls: 'bg-amber-500 hover:bg-amber-600 text-white' },
                    TRANSPORTE: { border: 'border-red-200', bg: 'bg-red-50/60', badge: 'bg-red-50 text-red-800 ring-red-300', dot: 'bg-red-500', btnCls: 'bg-red-600 hover:bg-red-700 text-white' },
                    PLANEJADOR: { border: 'border-green-200', bg: 'bg-green-50/60', badge: 'bg-green-50 text-green-800 ring-green-300', dot: 'bg-green-500', btnCls: 'bg-green-600 hover:bg-green-700 text-white' },
                  };
                  const cf = a ? COR_ETAPA_CARD[et.valor] : { border: 'border-omega-100', bg: 'bg-omega-50/40', badge: '', dot: '', btnCls: '' };
                  return (
                    <div key={et.valor} className={`rounded-xl border p-3 transition-colors ${a ? `${cf.border} ${cf.bg}` : 'border-omega-100 bg-omega-50/40'}`}>
                      {/* Header da etapa */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-omega-400">{et.rotulo}</span>
                        {a && (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ring-1 ring-inset ${cf.badge}`}>
                            <CheckCircle2 size={10} /> Assinado
                          </span>
                        )}
                      </div>

                      {a ? (
                        <div className="space-y-2">
                          {/* Preview da assinatura digital */}
                          {imagemAssinatura(a) ? (
                            <div className="rounded-lg bg-white border border-omega-200 p-1.5 flex items-center justify-center min-h-[48px]">
                              <img src={imagemAssinatura(a)} alt={`Assinatura de ${a.nome}`} className="max-h-10 max-w-full object-contain" />
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-sm font-bold text-omega-900">
                              <CheckCircle2 size={15} className="text-status-verde shrink-0" />
                              <span className="truncate">{a.nome}</span>
                            </div>
                          )}
                          <div className="text-[11px] text-omega-600 font-semibold truncate">{a.nome}</div>
                          <div className="text-[11px] text-omega-400">
                            {a.matricula ? `Matr. ${a.matricula}` : ''}
                            {a.matricula && a.assinado_em ? ' • ' : ''}
                            {a.assinado_em ? formatarDataHora(a.assinado_em) : ''}
                          </div>
                          <button onClick={() => removerAssinatura(et.valor)} className="text-[11px] font-bold text-status-vermelho hover:underline mt-1">
                            Remover assinatura
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <input
                            value={nomesAssinatura[et.valor] || ''}
                            onChange={(e) => setNomesAssinatura((n) => ({ ...n, [et.valor]: e.target.value }))}
                            className={inputCls}
                            placeholder={`Nome — ${et.rotulo.toLowerCase()}`}
                          />
                          <button
                            onClick={() => abrirModalAssin(et.valor, et.rotulo)}
                            disabled={false}
                            className={`w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${COR_ETAPA_CARD[et.valor]?.btnCls || 'btn-primary'}`}
                            title={`Assinar como ${et.rotulo}`}
                          >
                            <PenLine size={13} /> Assinar
                          </button>
                          <p className="text-[10px] text-omega-400">
                            Papel: {et.valor === 'OPERADOR' ? 'Operador' : et.valor === 'TRANSPORTE' ? 'Transporte' : 'Planejamento'}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Rodapé visual das assinaturas (quando ao menos 1 existe) */}
              {assinaturas.length > 0 && (
                <div className="border-t border-omega-100 pt-3">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-omega-400 mb-2">Comprovante de Assinaturas</div>
                  <div className={`grid gap-2 ${etapasAssinatura.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    {etapasAssinatura.map((et) => {
                      const a = assinaturaDe(et.valor);
                      const COR_RODAPE = {
                        OPERADOR: 'border-amber-200 bg-amber-50/40',
                        TRANSPORTE: 'border-red-200   bg-red-50/40',
                        PLANEJADOR: 'border-green-200 bg-green-50/40',
                      };
                      return (
                        <div key={et.valor} className={`rounded-lg border p-2 text-center text-[10px] min-h-[80px] flex flex-col items-center justify-center gap-1 ${a ? (COR_RODAPE[et.valor] || 'border-omega-100') : 'border-dashed border-omega-200 bg-omega-50/30'
                          }`}>
                          {a ? (
                            <>
                              {imagemAssinatura(a)
                                ? <img src={imagemAssinatura(a)} alt={a.nome} className="max-h-8 max-w-full object-contain mb-0.5" />
                                : <CheckCircle2 size={14} className="text-status-verde" />
                              }
                              <div className="font-bold text-omega-900 truncate w-full">{a.nome}</div>
                              {a.matricula && <div className="text-omega-400 font-mono">Matr. {a.matricula}</div>}
                              <div className="text-omega-400">{a.assinado_em ? formatarDataHora(a.assinado_em) : ''}</div>
                              <div className="font-extrabold uppercase tracking-wide text-[9px] text-omega-500">{et.rotulo}</div>
                            </>
                          ) : (
                            <>
                              <div className="w-5 h-5 rounded-full border border-dashed border-omega-300 flex items-center justify-center text-omega-300">
                                <PenLine size={10} />
                              </div>
                              <div className="text-omega-400 font-extrabold uppercase tracking-wide text-[9px]">{et.rotulo}</div>
                              <div className="text-omega-300 italic">Pendente</div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* 8. RODAPÉ / AUDITORIA */}
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="p-1.5 rounded-lg bg-omega-900 text-white"><History size={14} /></span>
                <span className="text-sm font-bold text-omega-900">Auditoria</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div className="rounded-xl border border-omega-100 bg-omega-50/50 px-3 py-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-omega-500">Criado por</div>
                  <div className="mt-0.5 font-semibold text-omega-900 truncate">{auditoria.criado_por || '—'}</div>
                </div>
                <div className="rounded-xl border border-omega-100 bg-omega-50/50 px-3 py-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-omega-500">Última modificação</div>
                  <div className="mt-0.5 font-semibold text-omega-900 truncate" title={auditoria.atualizado_por || ''}>
                    {auditoria.updated_at ? formatarDataHora(auditoria.updated_at) : '—'}
                  </div>
                  {auditoria.atualizado_por && <div className="text-[11px] text-omega-400 truncate">{auditoria.atualizado_por}</div>}
                </div>
                <button onClick={() => setVerLogs((v) => !v)} className="rounded-xl border border-omega-100 bg-omega-50/50 px-3 py-2 text-left hover:bg-omega-50 transition-colors">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-omega-500">Log de edições ({auditoria.logs.length})</div>
                  <div className="mt-0.5 font-semibold text-omega-900">{verLogs ? 'Ocultar histórico' : 'Ver histórico'}</div>
                </button>
                <div className="rounded-xl border border-omega-100 bg-omega-50/50 px-3 py-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-omega-500 flex items-center gap-1"><Eye size={11} /> Visualizações ({auditoria.visualizacoes})</div>
                  <div className="mt-0.5 font-semibold text-omega-900 tabular-nums">{auditoria.visualizacoes}</div>
                </div>
              </div>
              {verLogs && (
                <div className="mt-3 max-h-44 overflow-auto rounded-xl border border-omega-100 divide-y divide-omega-100">
                  {auditoria.logs.length === 0 && <div className="p-3 text-xs text-omega-400 italic">Nenhuma edição registrada.</div>}
                  {auditoria.logs.map((l) => (
                    <div key={l.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                      <span className="font-bold text-omega-900 shrink-0">{l.acao}</span>
                      <span className="text-omega-400 truncate">{l.autor || '—'}</span>
                      <span className="ml-auto text-omega-400 tabular-nums shrink-0">{formatarDataHora(l.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Ações inferiores (salvar fica só aqui, sem duplicata no topo) */}
            <div className="flex flex-col sm:flex-row gap-2">
              {parteId && (
                <button
                  onClick={() => setVerRelatorio(true)}
                  className="btn-secondary justify-center !py-3 text-sm sm:w-auto w-full"
                  title="Visualizar e exportar o relatório em PDF"
                >
                  <FileText size={16} /> Ver Relatório
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={salvando || carregando}
                className="btn-primary flex-1 justify-center !py-3 text-sm disabled:opacity-50"
              >
                {salvando ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : <><Save size={16} /> Salvar Relatório</>}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal de seleção de equipamentos (frota ativa) */}
      <Modal
        open={modalEquip}
        onClose={() => setModalEquip(false)}
        title="Selecionar Veículo"
        subtitle="Clique no veículo para vinculá-lo como equipamento"
        size="md"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
            <input
              value={buscaEquip}
              onChange={(e) => setBuscaEquip(e.target.value)}
              className="input pl-9"
              placeholder="Buscar TAG, placa ou modelo..."
              autoFocus
            />
          </div>
          <div className="max-h-80 overflow-auto rounded-xl border border-omega-100 divide-y divide-omega-100">
            {frotaAtiva.length === 0 && (
              <div className="p-6 text-center text-xs text-omega-400 italic">
                Nenhum veículo ativo encontrado na frota.
              </div>
            )}
            {frotaAtiva.map((v) => (
              <button
                key={v.tag}
                onClick={() => vincularEquipamento(v)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-omega-50 transition-colors"
              >
                <span className="w-9 h-9 rounded-xl bg-omega-900 text-white flex items-center justify-center shrink-0">
                  <Truck size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block font-mono font-extrabold text-omega-900 text-sm">
                    {v.tag} <span className="font-semibold text-omega-400">• {v.placa || '—'}</span>
                  </span>
                  <span className="block text-xs text-omega-500 truncate">
                    {v.modelo || 'Modelo não informado'}{v.status ? ` • ${v.status}` : ''}
                  </span>
                </span>
                <Plus size={16} className="ml-auto text-omega-300 shrink-0" />
              </button>
            ))}
          </div>
          <p className="text-[11px] text-omega-400 text-center">
            {frotaAtiva.length} veículo(s) ativo(s) • horímetro e status podem ser ajustados na linha após vincular
          </p>
        </div>
      </Modal>

      {/* Modal de inserção de atividade */}
      <Modal
        open={!!modalAtiv}
        onClose={() => setModalAtiv(null)}
        title="Adicionar Atividade"
        subtitle="Preencha a descrição e o status"
        size="sm"
        footer={
          <>
            <button onClick={() => setModalAtiv(null)} className="btn-secondary">Cancelar</button>
            <button
              onClick={confirmarModalAtiv}
              disabled={!modalAtiv?.descricao.trim() || !modalAtiv?.status}
              className="btn-primary disabled:opacity-40"
            >
              <Plus size={15} /> Adicionar
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">Descrição da Atividade <span className="text-status-vermelho">*</span></label>
            <input
              value={modalAtiv?.descricao || ''}
              onChange={(e) => setModalAtiv({ ...modalAtiv, descricao: e.target.value })}
              className="input"
              placeholder="Ex: Transporte de pessoal"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Status <span className="text-status-vermelho">*</span></label>
            <select
              value={modalAtiv?.status || ''}
              onChange={(e) => setModalAtiv({ ...modalAtiv, status: e.target.value })}
              className="input"
            >
              <option value="">Selecionar status...</option>
              {STATUS_ATIVIDADE.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {modalAtiv?.status && (
            <div>
              <span className={`chip ring-1 ring-inset ${COR_STATUS_ATIV[modalAtiv.status]}`}>
                {modalAtiv.status}
              </span>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal de inserção de ocorrência */}
      <Modal
        open={!!modalOcor}
        onClose={() => setModalOcor(null)}
        title="Adicionar Ocorrência"
        subtitle="Selecione o tipo e descreva"
        size="sm"
        footer={
          <>
            <button onClick={() => setModalOcor(null)} className="btn-secondary">Cancelar</button>
            <button
              onClick={confirmarModalOcor}
              disabled={!modalOcor?.tipo || !modalOcor?.descricao.trim()}
              className="btn-primary disabled:opacity-40"
            >
              <Plus size={15} /> Adicionar
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">Tipo <span className="text-status-vermelho">*</span></label>
            <select
              value={modalOcor?.tipo || ''}
              onChange={(e) => setModalOcor({ ...modalOcor, tipo: e.target.value })}
              className="input"
              autoFocus
            >
              <option value="">Selecionar tipo...</option>
              {TIPOS_OCORRENCIA.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Descrição <span className="text-status-vermelho">*</span></label>
            <textarea
              value={modalOcor?.descricao || ''}
              onChange={(e) => setModalOcor({ ...modalOcor, descricao: e.target.value })}
              className="input min-h-[90px]"
              placeholder="Descreva a ocorrência..."
            />
          </div>
        </div>
      </Modal>

      {/* Modal de Assinatura Digital */}
      <ModalAssinaturaDigital
        open={!!modalAssin}
        onClose={() => setModalAssin(null)}
        onConfirmar={confirmarAssinatura}
        etapa={modalAssin?.etapa}
        rotuloEtapa={modalAssin?.rotulo || ''}
        usuario={usuario}
        salvando={assinando}
        erro={erro}
      />

      {/* Preview do relatório (exportação PDF/HTML) */}
      {verRelatorio && (
        <RelatorioParteDiariaPreview
          relatorio={{
            ...form,
            id: parteId,
            numero_relatorio: parteId ? String(parteId).split('-')[0].toUpperCase() : undefined,
            assinaturas,
          }}
          onFechar={() => setVerRelatorio(false)}
        />
      )}
    </>
  );
}


