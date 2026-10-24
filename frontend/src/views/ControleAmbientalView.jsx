import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CloudFog,
  FileWarning,
  Fuel,
  Leaf,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import Modal from '../components/Modal.jsx';
import { authHeaders, lerSessao } from '../utils/sessao.js';
import { formatarDataSemTimezone, hojeISO, somarMesesISO } from '../utils/datas.js';
import { ehMaster, podeEscrever } from '../utils/permissoes.js';

export const eDiesel = (combustivel) => {
  if (!combustivel) return false;
  const c = String(combustivel).toUpperCase();
  return c.includes('DIESEL');
};

const CORES = {
  CONFORME: '#10B981',
  ALERTA: '#F59E0B',
  VENCIDO: '#DC2626',
  PENDENTE: '#EF4444',
};

const KPIS = [
  {
    chave: 'total_mobilizado',
    titulo: 'Total mobilizado',
    descricao: 'Veículos a diesel ativos',
    icone: Truck,
    cor: '#0F172A',
    fundo: 'bg-omega-50',
    texto: 'text-omega-900',
    borda: 'border-t-omega-900',
    percentualChave: null,
  },
  {
    chave: 'em_conformidade',
    titulo: 'Em conformidade',
    descricao: 'Validade superior a 30 dias',
    icone: ShieldCheck,
    cor: CORES.CONFORME,
    fundo: 'bg-emerald-50',
    texto: 'text-emerald-700',
    borda: 'border-t-emerald-500',
    percentualChave: 'conformidade_percentual',
  },
  {
    chave: 'em_alerta',
    titulo: 'Em alerta',
    descricao: 'Vencendo nos próximos 30 dias',
    icone: AlertTriangle,
    cor: CORES.ALERTA,
    fundo: 'bg-amber-50',
    texto: 'text-amber-700',
    borda: 'border-t-amber-500',
    percentualChave: 'alerta_percentual',
  },
  {
    chave: 'vencidos',
    titulo: 'Vencidos',
    descricao: 'Laudo fora da validade',
    icone: FileWarning,
    cor: CORES.VENCIDO,
    fundo: 'bg-red-50',
    texto: 'text-red-700',
    borda: 'border-t-red-600',
    percentualChave: 'vencidos_percentual',
  },
  {
    chave: 'pendentes',
    titulo: 'Pendentes',
    descricao: 'Sem medição cadastrada',
    icone: BadgeCheck,
    cor: CORES.PENDENTE,
    fundo: 'bg-red-50',
    texto: 'text-red-700',
    borda: 'border-t-red-500',
    percentualChave: 'pendentes_percentual',
  },
];

const FILTROS_STATUS = [
  { chave: 'TODOS', rotulo: 'Todos', contagem: 'total_mobilizado' },
  { chave: 'CONFORME', rotulo: 'Em Conformidade', contagem: 'em_conformidade' },
  { chave: 'ALERTA', rotulo: 'Em Alerta', contagem: 'em_alerta' },
  { chave: 'PENDENTE', rotulo: 'Pendentes', contagem: 'pendentes' },
  { chave: 'VENCIDO', rotulo: 'Vencidos', contagem: 'vencidos' },
];

const fmtNum = (valor) => Number(valor || 0).toLocaleString('pt-BR');
const fmtPct = (valor) => `${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function percentual(parte, total) {
  if (!total) return 0;
  return Math.round((parte / total) * 1000) / 10;
}

function recalcularResumo(lista) {
  const listaDiesel = (lista || []).filter((v) => eDiesel(v.combustivel));
  const total = listaDiesel.length;
  const emConformidade = listaDiesel.filter((v) => v.status === 'CONFORME').length;
  const emAlerta = listaDiesel.filter((v) => v.status === 'ALERTA').length;
  const vencidos = listaDiesel.filter((v) => v.status === 'VENCIDO').length;
  const pendentes = listaDiesel.filter((v) => v.status === 'PENDENTE').length;
  const comMedicao = total - pendentes;
  return {
    total_mobilizado: total,
    em_conformidade: emConformidade,
    em_alerta: emAlerta,
    vencidos,
    pendentes,
    com_medicao: comMedicao,
    cobertura_percentual: percentual(comMedicao, total),
    conformidade_percentual: percentual(emConformidade, total),
    alerta_percentual: percentual(emAlerta, total),
    vencidos_percentual: percentual(vencidos, total),
    pendentes_percentual: percentual(pendentes, total),
  };
}

function obterFarol(veiculo) {
  if (veiculo.status === 'PENDENTE') {
    return {
      chave: 'PENDENTE',
      rotulo: 'Pendente',
      fundo: '#F1F5F9',
      texto: '#B91C1C',
      borda: '#EF4444',
      ponto: '#EF4444',
    };
  }
  if (veiculo.status === 'VENCIDO') {
    return {
      chave: 'VENCIDO',
      rotulo: 'Vencido',
      fundo: '#DC2626',
      texto: '#FFFFFF',
      borda: '#DC2626',
      ponto: '#FFFFFF',
    };
  }
  if (veiculo.status === 'ALERTA') {
    const dias = Number(veiculo.dias_restantes ?? 0);
    if (dias <= 0) {
      return {
        chave: 'VENCE_HOJE',
        rotulo: 'Vence hoje',
        fundo: '#DC2626',
        texto: '#FFFFFF',
        borda: '#DC2626',
        ponto: '#FFFFFF',
      };
    }
    if (dias <= 10) {
      return {
        chave: 'CRITICO',
        rotulo: `Vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
        fundo: '#EA580C',
        texto: '#FFFFFF',
        borda: '#EA580C',
        ponto: '#FFFFFF',
      };
    }
    return {
      chave: 'ATENCAO',
      rotulo: `Vence em ${dias} dias`,
      fundo: '#F59E0B',
      texto: '#451A03',
      borda: '#F59E0B',
      ponto: '#451A03',
    };
  }
  return {
    chave: 'CONFORME',
    rotulo: 'Em conformidade',
    fundo: '#10B981',
    texto: '#064E3B',
    borda: '#10B981',
    ponto: '#064E3B',
  };
}

function KpiCard({ kpi, valor, percentual: pct, className = '' }) {
  const Icone = kpi.icone;
  return (
    <div className={`card overflow-hidden border-t-[3px] ${kpi.borda} p-4 ${className}`} data-kpi={kpi.chave}>
      <div className="flex items-start justify-between gap-2">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${kpi.fundo}`} style={{ color: kpi.cor }}>
          <Icone size={18} />
        </div>
        {kpi.percentualChave && (
          <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold tabular-nums ${kpi.fundo} ${kpi.texto}`}>
            {fmtPct(pct)}
          </span>
        )}
      </div>
      <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-500">{kpi.titulo}</div>
      <div className={`mt-0.5 text-2xl font-black tabular-nums tracking-tight ${kpi.texto}`}>{fmtNum(valor)}</div>
      <div className="mt-1 text-[11px] font-medium leading-snug text-omega-400">{kpi.descricao}</div>
    </div>
  );
}

function TooltipConformidade({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  return (
    <div className="rounded-xl border border-omega-100 bg-white px-3 py-2 shadow-xl">
      <div className="flex items-center gap-2 text-xs font-bold text-omega-900">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.cor }} />
        {item.nome}
      </div>
      <div className="mt-1 text-xs text-omega-500">
        <strong className="text-sm tabular-nums text-omega-900">{fmtNum(item.valor)}</strong> veículo(s) • {fmtPct(item.percentual)}
      </div>
    </div>
  );
}

function BadgeFarol({ veiculo }) {
  const farol = obterFarol(veiculo);
  return (
    <span
      data-farol={farol.chave}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold"
      style={{ backgroundColor: farol.fundo, color: farol.texto, borderColor: farol.borda }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: farol.ponto }} />
      {farol.rotulo}
    </span>
  );
}

function DiasRestantes({ veiculo }) {
  if (veiculo.status === 'PENDENTE') {
    return (
      <div className="leading-tight">
        <div className="text-sm font-bold text-omega-300">—</div>
        <div className="text-[10px] font-medium text-omega-400">sem laudo</div>
      </div>
    );
  }
  const dias = Number(veiculo.dias_restantes ?? 0);
  const farol = obterFarol(veiculo);
  const cor = {
    VENCIDO: '#DC2626',
    VENCE_HOJE: '#DC2626',
    CRITICO: '#EA580C',
    ATENCAO: '#B45309',
    CONFORME: '#047857',
  }[farol.chave] || '#475569';
  const legenda = dias < 0 ? 'em atraso' : dias === 0 ? 'vence hoje' : dias === 1 ? 'dia restante' : 'dias restantes';
  return (
    <div className="leading-tight">
      <div className="text-sm font-extrabold tabular-nums" style={{ color: cor }}>{fmtNum(dias)}</div>
      <div className="text-[10px] font-medium text-omega-400">{legenda}</div>
    </div>
  );
}

function EstadoCarregando() {
  return (
    <div className="card flex min-h-[420px] flex-col items-center justify-center gap-3 p-8">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <Loader2 size={26} className="animate-spin" />
      </span>
      <div className="text-sm font-bold text-omega-900">Carregando conformidade ambiental...</div>
      <div className="text-xs text-omega-400">Consultando medições e frota mobilizada.</div>
    </div>
  );
}

function EstadoErro({ mensagem, onTentarNovamente }) {
  return (
    <div className="card flex min-h-[380px] flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <AlertTriangle size={26} />
      </span>
      <div className="text-sm font-bold text-omega-900">Não foi possível carregar o painel.</div>
      <div className="max-w-md text-xs leading-relaxed text-omega-500">{mensagem}</div>
      <button type="button" onClick={onTentarNovamente} className="btn-secondary mt-1">
        <RefreshCw size={14} />
        Tentar novamente
      </button>
    </div>
  );
}

function ModalMedicao({ veiculo, onClose, onSalvo }) {
  const [dataMedicao, setDataMedicao] = useState(veiculo?.data_medicao || hojeISO());
  const [observacao, setObservacao] = useState(veiculo?.observacao || '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const validadePreview = dataMedicao ? somarMesesISO(dataMedicao, 6) : '';

  const fechar = () => {
    if (!salvando) onClose();
  };

  const salvar = async (e) => {
    e.preventDefault();
    if (!dataMedicao) {
      setErro('Informe a data da medição.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const resp = await fetch('/api/controle-ambiental/fumaca-preta', {
        method: 'POST',
        headers: authHeaders(lerSessao()),
        body: JSON.stringify({
          tag: veiculo.tag,
          data_medicao: dataMedicao,
          observacao,
        }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(corpo?.message || `Falha ao salvar a medição (HTTP ${resp.status}).`);
      }
      onSalvo(corpo.data.veiculo, corpo.data.criado);
    } catch (e) {
      setErro(e?.message || 'Não foi possível salvar a medição.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open
      onClose={fechar}
      title={`${veiculo.data_medicao ? 'Editar' : 'Lançar'} medição — ${veiculo.tag}`}
      subtitle={`${veiculo.modelo || 'Modelo não informado'} • ${veiculo.combustivel || 'Diesel'} • ${veiculo.placa}`}
      footer={(
        <>
          <button type="button" onClick={fechar} disabled={salvando} className="btn-secondary disabled:opacity-50">
            Cancelar
          </button>
          <button
            type="submit"
            form="form-medicao-fumaca"
            disabled={salvando || !dataMedicao}
            className="btn-primary disabled:opacity-50"
          >
            {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {salvando ? 'Salvando...' : veiculo.data_medicao ? 'Atualizar medição' : 'Salvar medição'}
          </button>
        </>
      )}
    >
      <form id="form-medicao-fumaca" onSubmit={salvar} className="space-y-4">
        {erro && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert">
            {erro}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
          <div>
            <label htmlFor="fumaca-tag" className="label">TAG</label>
            <input
              id="fumaca-tag"
              value={veiculo.tag}
              readOnly
              aria-readonly="true"
              className="input cursor-not-allowed bg-omega-50 font-extrabold text-omega-600"
            />
          </div>
          <div>
            <span className="label">Veículo</span>
            <div className="flex h-[38px] items-center gap-2 rounded-lg border border-omega-100 bg-omega-50/70 px-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-semibold text-omega-700">{veiculo.modelo || '—'}</span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-inset ring-amber-600/20">
                <Fuel size={11} className="text-amber-600" />
                {veiculo.combustivel || 'Diesel'}
              </span>
              <span className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-omega-500 ring-1 ring-inset ring-omega-200">
                {veiculo.placa}
              </span>
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="fumaca-data" className="label">
            Data da Medição <span className="text-red-500">*</span>
          </label>
          <input
            id="fumaca-data"
            type="date"
            required
            value={dataMedicao}
            onChange={(e) => setDataMedicao(e.target.value)}
            className="input"
            autoFocus
          />
        </div>

        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">
                <CalendarDays size={13} />
                Validade calculada
              </div>
              <div className="mt-1 text-xl font-black tabular-nums tracking-tight text-emerald-900" data-validade-preview>
                {validadePreview ? formatarDataSemTimezone(validadePreview) : '—'}
              </div>
            </div>
            <span className="w-fit rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              Data + 6 meses
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-emerald-700/80">
            A validade é recalculada automaticamente a cada alteração da data da medição.
          </p>
        </div>

        <div>
          <label htmlFor="fumaca-observacao" className="label">
            Observações <span className="font-normal text-omega-400">(opcional)</span>
          </label>
          <textarea
            id="fumaca-observacao"
            rows={3}
            maxLength={2000}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Informe detalhes da medição, laudo, responsável ou ocorrências..."
            className="input resize-none"
          />
          <div className="mt-1 text-right text-[10px] font-medium text-omega-400">
            {observacao.length}/2000
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function ControleAmbientalView() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [medicaoEmEdicao, setMedicaoEmEdicao] = useState(null);
  const [toast, setToast] = useState(null);

  const usuario = lerSessao()?.usuario;
  const podeEditar = ehMaster(usuario) || podeEscrever(usuario, 'controle-ambiental');

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch(`/api/controle-ambiental/fumaca-preta?_t=${Date.now()}`, {
        headers: authHeaders(lerSessao()),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(corpo?.message || `Falha ao carregar o painel (HTTP ${resp.status}).`);
      }
      setDados(corpo.data);
    } catch (e) {
      setErro(e?.message || 'Não foi possível carregar os dados de conformidade.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    buscar();
  }, [buscar]);

  const veiculos = useMemo(() => {
    return (dados?.veiculos || []).filter((v) => eDiesel(v.combustivel));
  }, [dados?.veiculos]);

  const resumo = useMemo(() => {
    if (dados?.resumo && veiculos.length === (dados?.veiculos || []).length) {
      return dados.resumo;
    }
    return recalcularResumo(veiculos);
  }, [dados?.resumo, dados?.veiculos, veiculos]);

  const dadosRosca = useMemo(() => [
    {
      chave: 'CONFORME',
      nome: 'Em conformidade',
      valor: resumo.em_conformidade || 0,
      percentual: resumo.conformidade_percentual || 0,
      cor: CORES.CONFORME,
    },
    {
      chave: 'ALERTA',
      nome: 'Alerta de vencimento',
      valor: resumo.em_alerta || 0,
      percentual: resumo.alerta_percentual || 0,
      cor: CORES.ALERTA,
    },
    {
      chave: 'VENCIDO',
      nome: 'Vencidos',
      valor: resumo.vencidos || 0,
      percentual: resumo.vencidos_percentual || 0,
      cor: CORES.VENCIDO,
    },
    {
      chave: 'PENDENTE',
      nome: 'Pendentes / sem registro',
      valor: resumo.pendentes || 0,
      percentual: resumo.pendentes_percentual || 0,
      cor: CORES.PENDENTE,
    },
  ], [resumo.alerta_percentual, resumo.conformidade_percentual, resumo.em_alerta, resumo.em_conformidade, resumo.pendentes, resumo.pendentes_percentual, resumo.vencidos, resumo.vencidos_percentual]);

  const totalRosca = dadosRosca.reduce((soma, item) => soma + item.valor, 0);

  const veiculosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return veiculos.filter((v) => {
      if (filtroStatus !== 'TODOS' && v.status !== filtroStatus) return false;
      if (!termo) return true;
      return [v.tag, v.modelo, v.placa, v.combustivel]
        .filter(Boolean)
        .some((valor) => String(valor).toLowerCase().includes(termo));
    });
  }, [busca, filtroStatus, veiculos]);

  const atualizadoEm = dados?.atualizado_em
    ? new Date(dados.atualizado_em).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    : null;

  const aoSalvarMedicao = (linha, criado) => {
    setDados((anterior) => {
      if (!anterior) return anterior;
      const veiculosAtualizados = anterior.veiculos.map((v) => (v.tag === linha.tag ? { ...v, ...linha } : v));
      return {
        ...anterior,
        veiculos: veiculosAtualizados,
        resumo: recalcularResumo(veiculosAtualizados),
        atualizado_em: new Date().toISOString(),
      };
    });
    setMedicaoEmEdicao(null);
    setToast(
      `${linha.tag}: medição ${criado ? 'lançada' : 'atualizada'} com sucesso. Validade até ${formatarDataSemTimezone(linha.validade)}.`
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-600">
            <Leaf size={13} />
            Meio Ambiente • Monitoramento Diesel
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-omega-900 sm:text-3xl">
            Controle Ambiental da Frota
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-omega-500">
            Plano de Monitoramento de Fumaça Preta (Escala Ringelmann) — conformidade e cobertura de medição exclusiva para a frota a <strong>Diesel</strong> mobilizada.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {atualizadoEm && (
            <span className="text-[11px] font-medium text-omega-400">
              Atualizado em {atualizadoEm}
            </span>
          )}
          <button
            type="button"
            onClick={buscar}
            disabled={carregando}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            title="Atualizar dados do painel"
          >
            <RefreshCw size={15} className={carregando ? 'animate-spin' : ''} />
            {carregando ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {erro && dados && (
        <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-start gap-2 text-sm text-red-800">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-bold">Falha ao atualizar o painel.</div>
              <div className="mt-0.5 text-xs text-red-700">{erro} Os dados exibidos são da última atualização bem-sucedida.</div>
            </div>
          </div>
          <button
            type="button"
            onClick={buscar}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
          >
            <RefreshCw size={13} /> Tentar novamente
          </button>
        </div>
      )}

      {carregando && !dados ? (
        <EstadoCarregando />
      ) : !dados ? (
        <EstadoErro mensagem={erro} onTentarNovamente={buscar} />
      ) : (
        <div className={'space-y-5 ' + (carregando ? 'pointer-events-none opacity-60 transition-opacity' : '')}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {KPIS.map((kpi) => (
              <KpiCard
                key={kpi.chave}
                kpi={kpi}
                valor={resumo[kpi.chave] || 0}
                percentual={kpi.percentualChave ? resumo[kpi.percentualChave] : 0}
                className={kpi.chave === 'total_mobilizado' ? 'col-span-2 md:col-span-1' : ''}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <section className="card min-w-0 p-5 xl:col-span-7">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-extrabold text-omega-900">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <ShieldCheck size={16} />
                    </span>
                    Status de Conformidade
                  </div>
                  <p className="mt-1 text-xs text-omega-500">
                    Proporção da frota a diesel mobilizada por situação do laudo de fumaça preta.
                  </p>
                </div>
                <span className="hidden rounded-full bg-omega-50 px-2.5 py-1 text-[10px] font-bold text-omega-500 sm:inline-flex">
                  {fmtNum(resumo.total_mobilizado || 0)} veículos a diesel
                </span>
              </div>

              <div className="mt-3 grid items-center gap-3 sm:grid-cols-[1.2fr_1fr]">
                <div
                  className="relative h-[250px] w-full"
                  role="img"
                  aria-label={`Distribuição da conformidade: ${dadosRosca.map((d) => `${d.nome} ${d.valor}`).join(', ')}`}
                >
                  {totalRosca > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={dadosRosca}
                          dataKey="valor"
                          nameKey="nome"
                          cx="50%"
                          cy="50%"
                          innerRadius={70}
                          outerRadius={103}
                          paddingAngle={2}
                          stroke="#FFFFFF"
                          strokeWidth={3}
                        >
                          {dadosRosca.map((item) => (
                            <Cell key={item.chave} fill={item.cor} />
                          ))}
                        </Pie>
                        <Tooltip content={<TooltipConformidade />} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <div className="flex h-[206px] w-[206px] items-center justify-center rounded-full border-[22px] border-omega-100">
                        <CloudFog size={30} className="text-omega-300" />
                      </div>
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Frota Diesel</div>
                    <div className="text-3xl font-black tabular-nums tracking-tight text-omega-900">{fmtNum(resumo.total_mobilizado || 0)}</div>
                    <div className="mt-0.5 text-[10px] font-semibold text-omega-400">veículos</div>
                    <div className="mt-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700">
                      {fmtPct(resumo.conformidade_percentual)} conformes
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {dadosRosca.map((item) => (
                    <div key={item.chave} className="flex items-center gap-2 rounded-xl px-2.5 py-2 hover:bg-omega-50/70">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.cor }} />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-omega-600">{item.nome}</span>
                      <span className="text-xs font-extrabold tabular-nums text-omega-900">{fmtNum(item.valor)}</span>
                      <span className="w-12 text-right text-[10px] font-bold tabular-nums text-omega-400">{fmtPct(item.percentual)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="card min-w-0 p-5 xl:col-span-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-extrabold text-omega-900">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                      <CloudFog size={16} />
                    </span>
                    Cobertura de Medição
                  </div>
                  <p className="mt-1 text-xs text-omega-500">
                    Percentual da frota a diesel mobilizada com laudo cadastrado.
                  </p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-omega-400">% mapeado</span>
              </div>

              <div className="mt-6 flex items-end justify-between gap-3">
                <div>
                  <div className="text-4xl font-black tabular-nums tracking-tight text-omega-900">{fmtPct(resumo.cobertura_percentual)}</div>
                  <div className="mt-1 text-xs font-semibold text-omega-500">
                    {fmtNum(resumo.com_medicao || 0)} de {fmtNum(resumo.total_mobilizado || 0)} veículos a diesel com medição
                  </div>
                </div>
                <div className="rounded-xl bg-sky-50 px-3 py-2 text-center">
                  <div className="text-lg font-black tabular-nums text-sky-700">{fmtNum(resumo.pendentes || 0)}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-sky-500">sem laudo</div>
                </div>
              </div>

              <div
                className="mt-5 h-3 overflow-hidden rounded-full bg-omega-100"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Number(resumo.cobertura_percentual || 0)}
                aria-label="Cobertura de medição da frota"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 transition-all duration-700"
                  style={{ width: `${Math.min(100, Math.max(0, Number(resumo.cobertura_percentual || 0)))}%` }}
                />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-omega-100 pt-4">
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-omega-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Com laudo
                  </div>
                  <div className="mt-1 text-lg font-extrabold tabular-nums text-omega-900">{fmtNum(resumo.com_medicao || 0)}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-omega-400">
                    <span className="h-2 w-2 rounded-full bg-red-500" /> Sem laudo
                  </div>
                  <div className="mt-1 text-lg font-extrabold tabular-nums text-omega-900">{fmtNum(resumo.pendentes || 0)}</div>
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-omega-50/80 px-3 py-2.5 text-[11px] leading-relaxed text-omega-500">
                A cobertura considera qualquer medição cadastrada para a frota a diesel, independentemente da validade. Laudos vencidos continuam contabilizados na cobertura.
              </div>
            </section>
          </div>

          <section className="card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-omega-100 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-omega-900">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-omega-50 text-omega-600">
                    <Truck size={16} />
                  </span>
                  Frota a Diesel monitorada
                  {!podeEditar && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-omega-100 px-2 py-0.5 text-[10px] font-bold text-omega-500">
                      <LockKeyhole size={11} /> Somente leitura
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-omega-500">
                  {fmtNum(veiculosFiltrados.length)} de {fmtNum(veiculos.length)} veículo(s) a diesel mobilizado(s) exibido(s).
                </p>
              </div>
              <div className="relative w-full sm:w-72">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
                <input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar TAG, modelo ou placa..."
                  className="input w-full !py-1.5 pl-9 text-xs"
                  aria-label="Buscar veículo por TAG, modelo ou placa"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-b border-omega-100 bg-omega-50/40 px-4 py-2.5">
              {FILTROS_STATUS.map((filtro) => {
                const ativo = filtroStatus === filtro.chave;
                return (
                  <button
                    key={filtro.chave}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => setFiltroStatus(filtro.chave)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                      ativo
                        ? 'border-omega-900 bg-omega-900 text-white'
                        : 'border-omega-200 bg-white text-omega-600 hover:border-omega-300 hover:bg-omega-50'
                    }`}
                  >
                    {filtro.rotulo}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                      ativo ? 'bg-white/15 text-white' : 'bg-omega-100 text-omega-500'
                    }`}>
                      {fmtNum(resumo[filtro.contagem] || 0)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead>
                  <tr className="border-b border-omega-100 bg-omega-50/60 text-[10px] font-extrabold uppercase tracking-wider text-omega-500">
                    <th className="px-4 py-2.5">TAG</th>
                    <th className="px-4 py-2.5">Modelo</th>
                    <th className="px-4 py-2.5">Placa</th>
                    <th className="px-4 py-2.5">Combustível</th>
                    <th className="px-4 py-2.5">Data da Medição</th>
                    <th className="px-4 py-2.5">Validade (6 Meses)</th>
                    <th className="px-4 py-2.5">Dias Restantes</th>
                    <th className="px-4 py-2.5">Status (Farol)</th>
                    <th className="px-4 py-2.5 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-omega-100">
                  {veiculosFiltrados.map((v) => {
                    const temMedicao = !!v.data_medicao;
                    return (
                      <tr key={v.tag} data-tag={v.tag} data-status={v.status} className="transition-colors hover:bg-omega-50/60">
                        <td className="px-4 py-3">
                          <div className="font-extrabold tracking-wide text-omega-900">{v.tag}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="max-w-[210px] truncate text-xs font-semibold text-omega-700">{v.modelo || '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-bold tabular-nums text-omega-700">{v.placa}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-inset ring-amber-600/20">
                            <Fuel size={11} className="text-amber-600" />
                            {v.combustivel || 'Diesel'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums text-omega-600">
                          {formatarDataSemTimezone(v.data_medicao)}
                        </td>
                        <td className="px-4 py-3 text-xs font-bold tabular-nums text-omega-800">
                          {formatarDataSemTimezone(v.validade)}
                        </td>
                        <td className="px-4 py-3">
                          <DiasRestantes veiculo={v} />
                        </td>
                        <td className="px-4 py-3">
                          <BadgeFarol veiculo={v} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {podeEditar ? (
                            <button
                              type="button"
                              onClick={() => setMedicaoEmEdicao(v)}
                              aria-label={`${temMedicao ? 'Editar' : 'Lançar'} medição de ${v.tag}`}
                              title={`${temMedicao ? 'Editar' : 'Lançar'} medição`}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                                temMedicao
                                  ? 'border-omega-200 bg-white text-omega-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100'
                              }`}
                            >
                              {temMedicao ? <Pencil size={13} /> : <Plus size={14} />}
                              {temMedicao ? 'Editar' : 'Lançar'}
                            </button>
                          ) : (
                            <span className="inline-flex text-omega-300" title="Seu perfil não pode editar medições">
                              <LockKeyhole size={15} />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {veiculosFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center">
                        <CloudFog size={28} className="mx-auto text-omega-300" />
                        <div className="mt-2 text-sm font-bold text-omega-700">Nenhum veículo a diesel encontrado</div>
                        <div className="mt-0.5 text-xs text-omega-400">
                          {veiculos.length === 0
                            ? 'Não há veículos a diesel com status Mobilizado no momento.'
                            : 'Ajuste a busca ou o filtro de situação.'}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {medicaoEmEdicao && (
        <ModalMedicao
          key={medicaoEmEdicao.tag}
          veiculo={medicaoEmEdicao}
          onClose={() => setMedicaoEmEdicao(null)}
          onSalvo={aoSalvarMedicao}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] flex max-w-md items-center gap-2 rounded-xl bg-omega-900 py-2.5 pl-3 pr-4 text-sm font-semibold text-white shadow-2xl">
          <CheckCircle2 size={17} className="shrink-0 text-emerald-400" />
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} className="ml-1 rounded-full p-0.5 hover:bg-white/15" aria-label="Fechar notificação">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
