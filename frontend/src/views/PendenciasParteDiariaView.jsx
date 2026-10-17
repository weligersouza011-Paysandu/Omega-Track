import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CalendarDays, Check, CheckCircle2, ClipboardList, Pencil,
  RefreshCw, Search, Trash2, Truck, UserCheck, X,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import StatCard from '../components/StatCard.jsx';
import CalendarioDuplo from '../components/CalendarioDuplo.jsx';
import ParteDiariaForm from '../components/ParteDiariaForm.jsx';
import { authHeaders } from '../utils/sessao.js';
import {
  diaSemanaISO, diaUtilAnteriorISO, formatarDataSemTimezone as formatarData, somarDiasISO,
} from '../utils/datas.js';

function normalizar(v) {
  return String(v || '').trim().toUpperCase();
}

function diaSemanaCurto(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('-feira', '');
}

// Atalhos de seleção rápida do calendário: janelas de N dias corridos
// terminando no dia útil anterior (D-1) — mesma semântica do backend.
const JANELAS_RAPIDAS = [
  { valor: 1, label: 'D-1' },
  { valor: 7, label: '7 dias' },
  { valor: 15, label: '15 dias' },
  { valor: 30, label: '30 dias' },
];

function janelaAuditavel(dias) {
  const fim = diaUtilAnteriorISO();
  const datas = [];
  for (let i = dias - 1; i >= 0; i -= 1) {
    const d = somarDiasISO(fim, -i);
    if (diaSemanaISO(d) !== 0) datas.push(d);
  }
  return datas;
}

// ============================================================================
// Gestão de Pendências (VISÃO ADM — Master / Transporte / Administrador).
// Período auditado escolhido no CALENDÁRIO DUPLO (dias avulsos ou intervalo
// contínuo por arraste; padrão de abertura: dia útil anterior, D-1). A lista
// mostra os veículos mobilizados SEM Parte Diária nos dias selecionados,
// identifica o último operador responsável e permite:
//  - Lançar Retroativo (formulário com data + veículo travados);
//  - Excluir / Descartar a pendência (inconsistência de frota).
// A criação da Parte Diária dá baixa automática: o item some da tabela.
//
// `embutido`: renderiza em modo compacto quando usada dentro de uma aba da
// tela de Início (oculta o título grande da página dedicada).
// ============================================================================
export default function PendenciasParteDiariaView({ sessao, embutido = false }) {
  const [pendencias, setPendencias] = useState([]);
  const [meta, setMeta] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  // Calendário duplo: datas selecionadas (ISO) para a auditoria.
  // Padrão de abertura da tela: dia útil anterior (D-1).
  const [selecionadas, setSelecionadas] = useState(() => new Set([diaUtilAnteriorISO()]));
  // Datas efetivamente auditadas no último fetch OK (base para recarregar).
  const [datasAuditadas, setDatasAuditadas] = useState([]);
  const [busca, setBusca] = useState('');
  const [veiculos, setVeiculos] = useState([]);

  // { aberto, prefill: { data, tag, travar } | null }
  const [lancar, setLancar] = useState({ aberto: false, prefill: null });
  const [descartar, setDescartar] = useState(null);
  const [descartando, setDescartando] = useState(false);
  const [toast, setToast] = useState(null);

  // Troca manual do operador responsável (override de ADM): pendência alvo,
  // lista de usuários cadastrados e seleção (lista ou nome/matrícula manuais).
  const [trocar, setTrocar] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [buscaOperador, setBuscaOperador] = useState('');
  const [operadorSelecionado, setOperadorSelecionado] = useState(null);
  const [manualOperador, setManualOperador] = useState({ nome: '', matricula: '' });
  const [salvandoOperador, setSalvandoOperador] = useState(false);
  // Exclusão com efeito suave: ids em fade antes de sair da lista.
  const [saindo, setSaindo] = useState(() => new Set());

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Busca a auditoria para as datas selecionadas no calendário
  // (?datas=YYYY-MM-DD,YYYY-MM-DD — modo "datas" do backend).
  const fetchPendencias = async (datasParam) => {
    const base = Array.isArray(datasParam) ? datasParam : [...selecionadas];
    const lista = [...new Set(base.map((d) => String(d).slice(0, 10)))].sort();
    if (!lista.length) {
      setPendencias([]);
      setMeta(null);
      setDatasAuditadas([]);
      setCarregando(false);
      return;
    }
    const params = new URLSearchParams({ datas: lista.join(','), _t: String(Date.now()) });
    const urlConsulta = `/api/partes-diarias/pendencias?${params.toString()}`;
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch(urlConsulta, {
        headers: {
          ...authHeaders(sessao),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
      if (!resp.ok) {
        // Captura a mensagem exata da API (ex.: erro do Prisma/migration).
        let mensagemApi = '';
        try {
          const corpoErro = await resp.json();
          mensagemApi = corpoErro?.message || corpoErro?.error || '';
        } catch {
          /* corpo nao-JSON (proxy/502) */
        }
        const erroApi = new Error(mensagemApi || `API respondeu ${resp.status}`);
        erroApi.status = resp.status;
        erroApi.mensagemApi = mensagemApi;
        throw erroApi;
      }
      const corpo = await resp.json();
      setPendencias(Array.isArray(corpo?.data) ? corpo.data : []);
      setMeta(corpo?.meta || null);
      setDatasAuditadas(
        Array.isArray(corpo?.meta?.datas) && corpo.meta.datas.length ? corpo.meta.datas : lista,
      );
    } catch (e) {
      // Diagnostico completo no DevTools (F12 → Console) para falhas da API.
      console.error('[pendencias] Falha ao consultar a auditoria de pendências', {
        url: urlConsulta,
        status: e?.status ?? null,
        mensagem: e?.message || null,
        mensagemApi: e?.mensagemApi || null,
        erro: e,
      });
      setErro(
        e?.status
          ? `Não foi possível carregar a auditoria de pendências (HTTP ${e.status}${e.mensagemApi ? `: ${e.mensagemApi}` : ''}).`
          : 'Não foi possível carregar a auditoria de pendências. Verifique se o backend está no ar.',
      );
      setPendencias([]);
    } finally {
      setCarregando(false);
    }
  };

  // Recarrega a MESMA seleção já auditada (baixa automática, descarte,
  // lançamento retroativo) — sem perder o período em tela.
  const recarregar = () => fetchPendencias(datasAuditadas.length ? datasAuditadas : [...selecionadas]);

  // Atalhos do calendário (D-1 / 7 / 15 / 30): seleciona a janela e consulta.
  const aplicarJanela = (valor) => {
    const datas = janelaAuditavel(valor);
    setSelecionadas(new Set(datas));
    fetchPendencias(datas);
  };

  const carregarVeiculos = async () => {
    try {
      const resp = await fetch('/api/mob-desmob?limit=200');
      if (!resp.ok) return;
      const { data } = await resp.json();
      if (Array.isArray(data)) setVeiculos(data);
    } catch {
      /* o formulário segue com a TAG já travada do prefill */
    }
  };

  // Usuários cadastrados para o seletor "Trocar Operador".
  const carregarUsuarios = async () => {
    try {
      const resp = await fetch('/api/usuarios', { headers: authHeaders(sessao) });
      if (!resp.ok) return;
      const { data } = await resp.json();
      if (Array.isArray(data)) setUsuarios(data);
    } catch {
      /* a troca segue disponível por nome/matrícula manuais */
    }
  };

  useEffect(() => {
    // Abertura da tela: audita o dia útil anterior (D-1) já selecionado.
    fetchPendencias([...selecionadas]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    carregarVeiculos();
    carregarUsuarios();
  }, []);

  const filtradas = useMemo(() => {
    const q = normalizar(busca);
    if (!q) return pendencias;
    return pendencias.filter((p) => [
      p.tag, p.placa, p.ultimo_operador_nome, p.ultimo_operador_matricula, p.data_pendente,
    ].some((v) => normalizar(v).includes(q)));
  }, [pendencias, busca]);

  // Lista do modal "Trocar Operador": operacionais primeiro, filtrada pela
  // busca por nome/matrícula/função e limitada para render leve.
  const usuariosFiltrados = useMemo(() => {
    const peso = (u) => (u.tipo === 'OPERACIONAL' ? 0 : 1);
    const ordenados = [...usuarios].sort(
      (a, b) => peso(a) - peso(b) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'),
    );
    const q = normalizar(buscaOperador);
    if (!q) return ordenados.slice(0, 60);
    return ordenados
      .filter((u) => [u.nome, u.matricula, u.funcao].some((v) => normalizar(v).includes(q)))
      .slice(0, 60);
  }, [usuarios, buscaOperador]);

  const stats = useMemo(() => {
    const tags = new Set(pendencias.map((p) => normalizar(p.tag)));
    return {
      total: pendencias.length,
      veiculos: tags.size,
      ultimaData: pendencias[0]?.data_pendente || null,
    };
  }, [pendencias]);

  // Marcadores do calendário: dias auditados sem pendência ficam com 0
  // (ponto verde) e dias com pendência recebem o selo âmbar com a contagem.
  const contagensCalendario = useMemo(() => {
    const mapa = new Map();
    (meta?.datas || []).forEach((d) => mapa.set(d, 0));
    pendencias.forEach((p) => {
      const d = String(p.data_pendente).slice(0, 10);
      mapa.set(d, (mapa.get(d) || 0) + 1);
    });
    return mapa;
  }, [meta, pendencias]);

  const rotuloPeriodo = useMemo(() => {
    const datas = meta?.datas || [];
    if (datas.length === 1) return `Auditado: ${formatarData(datas[0])} • ${diaSemanaCurto(datas[0])}`;
    if (datas.length > 1) return `${datas.length} dias auditados • até ${formatarData(datas[datas.length - 1])}`;
    return 'Auditoria seg–sáb';
  }, [meta]);

  // Lança retroativo: abre o formulário com a data do dia pendente e o
  // veículo correspondente TRAVADOS (não vaza para outro dia/frota).
  const lancarRetroativo = (pd) => {
    setLancar({
      aberto: true,
      prefill: { data: pd.data_pendente, tag: pd.tag, travar: true },
    });
  };

  const aoSalvarForm = async (msg, opts) => {
    if (!opts?.manterAberto) setLancar({ aberto: false, prefill: null });
    setToast(msg || 'Parte Diária lançada — pendência baixada automaticamente.');
    // Baixa automática: a pendência é derivada — recarrega e o item some.
    await recarregar();
  };

  const fecharForm = () => {
    setLancar({ aberto: false, prefill: null });
    recarregar();
  };

  // Abre o modal de troca com o estado limpo para a pendência alvo.
  const abrirTroca = (pd) => {
    setTrocar(pd);
    setBuscaOperador('');
    setOperadorSelecionado(null);
    setManualOperador({ nome: '', matricula: '' });
  };

  const fecharTroca = () => {
    if (salvandoOperador) return;
    setTrocar(null);
  };

  // Aplica o retorno do PATCH direto na linha (atualização instantânea);
  // em seguida sincroniza com o backend (recarregar).
  const confirmarTroca = async () => {
    if (!trocar || salvandoOperador) return;
    const nomeManual = manualOperador.nome.trim();
    const matriculaManual = manualOperador.matricula.trim();
    if (!operadorSelecionado && !nomeManual && !matriculaManual) return;
    setSalvandoOperador(true);
    try {
      const payload = { id: trocar.id };
      if (operadorSelecionado) {
        payload.operador_id = operadorSelecionado.id;
      } else {
        if (nomeManual) payload.operador_nome = nomeManual;
        if (matriculaManual) payload.operador_matricula = matriculaManual;
      }
      const resp = await fetch('/api/partes-diarias/pendencias/trocar-operador', {
        method: 'PATCH',
        headers: authHeaders(sessao),
        body: JSON.stringify(payload),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.message || `Falha ao trocar operador (API ${resp.status})`);
      const dados = corpo?.data || {};
      setPendencias((anteriores) => anteriores.map((p) => (p.id === trocar.id ? { ...p, ...dados } : p)));
      setToast(`Operador responsável atualizado para ${dados.ultimo_operador_nome || nomeManual || '—'}.`);
      setTrocar(null);
      await recarregar();
    } catch (e) {
      setToast(`Falha ao trocar operador: ${e.message}`);
    } finally {
      setSalvandoOperador(false);
    }
  };

  // Remove o override manual: a pendência volta ao operador derivado do
  // histórico (PATCH sem operador — o backend apaga o override).
  const restaurarOperadorAutomatico = async () => {
    if (!trocar || salvandoOperador) return;
    setSalvandoOperador(true);
    try {
      const resp = await fetch('/api/partes-diarias/pendencias/trocar-operador', {
        method: 'PATCH',
        headers: authHeaders(sessao),
        body: JSON.stringify({ id: trocar.id }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.message || `Falha ao restaurar (API ${resp.status})`);
      setToast('Atribuição automática restaurada (operador do histórico de lançamentos).');
      setTrocar(null);
      await recarregar();
    } catch (e) {
      setToast(`Falha ao restaurar atribuição: ${e.message}`);
    } finally {
      setSalvandoOperador(false);
    }
  };

  const confirmarDescartar = async () => {
    if (!descartar || descartando) return;
    setDescartando(true);
    const alvo = descartar;
    try {
      const resp = await fetch(
        `/api/partes-diarias/pendencias/${encodeURIComponent(alvo.id)}`,
        {
          method: 'DELETE',
          headers: authHeaders(sessao),
          body: JSON.stringify({ motivo: 'Descarte manual via Gestão de Pendências (ADM)' }),
        },
      );
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.message || `Falha ao descartar (API ${resp.status})`);
      }
      setDescartar(null);
      setToast('Pendência descartada — veículo/data dispensados da auditoria.');
      // Efeito suave: desvanece a linha e só então remove da lista + sincroniza.
      setSaindo((prev) => new Set(prev).add(alvo.id));
      window.setTimeout(() => {
        setPendencias((prev) => prev.filter((p) => p.id !== alvo.id));
        setSaindo((prev) => {
          const novo = new Set(prev);
          novo.delete(alvo.id);
          return novo;
        });
        recarregar();
      }, 320);
    } catch (e) {
      setToast(`Falha ao descartar: ${e.message}`);
    } finally {
      setDescartando(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho (oculto no modo embutido — a aba da Home já tem título) */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        {!embutido && (
          <div>
            <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Administração / Transporte</div>
            <h1 className="mt-1 text-2xl font-extrabold text-omega-900 tracking-tight sm:text-3xl">Gestão de Pendências</h1>
            <p className="mt-1 text-sm text-omega-500">
              Veículos mobilizados que ficaram sem Parte Diária em um dia útil (seg–sáb).
              Selecione as datas no calendário abaixo — o dia útil anterior (D-1) já vem
              selecionado como foco padrão da auditoria.
            </p>
          </div>
        )}
      </div>

      {/* Período auditado: calendário duplo + botão principal de verificação */}
      <div className="card p-3 md:p-4">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 rounded-lg bg-omega-900 text-white shrink-0">
              <CalendarDays size={16} />
            </span>
            <div className="min-w-0">
              <h3 className="font-bold text-omega-900 leading-tight">Período auditado</h3>
              <p className="text-[11px] text-omega-500">
                Clique para acumular dias avulsos ou arraste para um intervalo contínuo (seg–sáb).
                {selecionadas.size > 0 && ` ${selecionadas.size} dia(s) selecionado(s) • máx. 31.`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 xl:ml-auto">
            {JANELAS_RAPIDAS.map((j) => (
              <button
                key={j.valor}
                type="button"
                onClick={() => aplicarJanela(j.valor)}
                disabled={carregando}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-omega-200 text-omega-600 hover:bg-omega-50 hover:text-omega-900 disabled:opacity-50 transition-colors"
                title={j.valor === 1
                  ? 'Selecionar o dia útil anterior (D-1) e verificar'
                  : `Selecionar os últimos ${j.valor} dias corridos até D-1 e verificar`}
              >
                {j.label}
              </button>
            ))}
            <button
              onClick={() => fetchPendencias([...selecionadas])}
              disabled={carregando || selecionadas.size === 0}
              className="btn-primary !py-2 text-xs md:text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              title="Consultar as datas selecionadas no calendário"
            >
              <RefreshCw size={15} className={carregando ? 'animate-spin' : ''} />
              Verificar Pendências
            </button>
          </div>
        </div>
        <CalendarioDuplo
          selecionadas={selecionadas}
          onChange={setSelecionadas}
          contagens={contagensCalendario}
          onAviso={setToast}
        />
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total de Pendências na Janela"
          value={stats.total}
          icon={AlertTriangle}
          iconBg={stats.total > 0 ? 'bg-status-vermelho' : 'bg-status-verde'}
          sub={rotuloPeriodo}
        />
        <StatCard
          title="Veículos Envolvidos"
          value={stats.veiculos}
          icon={Truck}
          iconBg="bg-omega-900"
          sub="Frota mobilizada sem lançamento"
        />
        <StatCard
          title="Pendência Mais Recente"
          value={stats.ultimaData ? formatarData(stats.ultimaData) : '—'}
          icon={CalendarClock}
          iconBg="bg-omega-accent"
          sub={stats.ultimaData ? `${diaSemanaCurto(stats.ultimaData)} • mais recente da seleção` : 'Frota em dia na seleção'}
        />
      </div>

      {/* Tabela de pendências */}
      <div className={`card overflow-hidden ${pendencias.length > 0 ? '!border-amber-300 ring-1 ring-amber-500/20' : ''}`}>
        <div className="p-4 border-b border-omega-100 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`p-1.5 rounded-lg text-white shrink-0 ${pendencias.length > 0 ? 'bg-amber-500' : 'bg-omega-900'}`}>
              <ClipboardList size={16} />
            </span>
            <div>
              <h3 className="font-bold text-omega-900 leading-tight">Lançamentos pendentes</h3>
              <p className="text-[11px] text-omega-500">
                Data Pendente • Veículo • Operador Atribuído • Status
              </p>
            </div>
          </div>
          <div className="relative sm:max-w-sm flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="input pl-9"
              placeholder="Buscar TAG, placa, operador ou data..."
            />
          </div>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center p-10 text-omega-500 text-sm font-semibold">
            <RefreshCw size={20} className="animate-spin mr-2" /> Auditando pendências...
          </div>
        ) : erro ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="mx-auto text-status-amarelo mb-2" />
            <div className="text-sm font-semibold text-omega-700 mb-1">Falha ao carregar</div>
            <div className="text-xs text-omega-500 mb-4">{erro}</div>
            <button onClick={recarregar} className="btn-secondary !py-2 text-xs inline-flex items-center gap-1.5">
              <RefreshCw size={14} /> Tentar novamente
            </button>
          </div>
        ) : filtradas.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle2 size={36} className="mx-auto text-status-verde mb-3" />
            <div className="text-sm font-bold text-omega-800 mb-1">
              {pendencias.length === 0 ? 'Frota em dia — nenhuma pendência de lançamento!' : 'Nenhum resultado para esta busca'}
            </div>
            <div className="text-xs text-omega-500">
              {pendencias.length === 0
                ? 'Todos os veículos mobilizados têm Parte Diária nos dias úteis auditados.'
                : 'Ajuste a busca ou limpe o campo de pesquisa.'}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1040px]">
              <thead className="bg-omega-50/70">
                <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-bold border-b border-omega-100">
                  <th className="px-4 py-3">Data Pendente</th>
                  <th className="px-4 py-3">Veículo (TAG / Placa)</th>
                  <th className="px-4 py-3">Operador Atribuído</th>
                  <th className="px-4 py-3">Status do Lançamento</th>
                  <th className="px-4 py-3">Última Parte Diária</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-omega-100">
                {filtradas.map((pd) => (
                  <tr
                    key={pd.id}
                    className={`transition-opacity duration-300 ${saindo.has(pd.id) ? 'opacity-0' : 'opacity-100'} hover:bg-omega-50/60`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-bold text-omega-900 tabular-nums">{formatarData(pd.data_pendente)}</div>
                      <div className="text-[11px] text-omega-400 capitalize">{diaSemanaCurto(pd.data_pendente)}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-bold text-omega-900">{pd.tag}</div>
                      <div className="text-xs text-omega-500 font-mono">{pd.placa || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-start">
                        {pd.ultimo_operador_nome || pd.ultimo_operador_matricula ? (
                          <>
                            <div className="text-omega-800 font-medium flex items-center gap-1.5">
                              <UserCheck size={13} className="text-omega-400 shrink-0" />
                              {pd.ultimo_operador_nome || '—'}
                            </div>
                            <div className="text-xs text-omega-500 font-mono">Matr. {pd.ultimo_operador_matricula || '—'}</div>
                          </>
                        ) : (
                          <span className="text-xs text-omega-400 italic">Sem histórico de lançamento</span>
                        )}
                        {pd.operador_editado && (
                          <span
                            className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-600/20"
                            title="Operador atribuído manualmente pela administração"
                          >
                            <Pencil size={9} /> Editado por ADM
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold ring-1 ring-inset bg-amber-50 text-status-amarelo ring-amber-600/20"
                        title="Parte Diária ainda não registrada para este veículo neste dia"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-status-amarelo" />
                        Pendente de Registro
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-omega-600">
                        {pd.ultima_parte_data ? formatarData(pd.ultima_parte_data) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end items-center gap-1.5">
                        <button
                          onClick={() => abrirTroca(pd)}
                          className="btn-secondary !py-1.5 !px-2.5 text-xs inline-flex items-center gap-1.5"
                          title={`Trocar o operador responsável pela pendência de ${pd.tag} em ${formatarData(pd.data_pendente)}`}
                        >
                          <UserCheck size={13} /> Trocar Operador
                        </button>
                        <button
                          onClick={() => lancarRetroativo(pd)}
                          className="btn-primary !py-1.5 !px-2.5 text-xs inline-flex items-center gap-1.5"
                          title={`Lançar Parte Diária retroativa de ${formatarData(pd.data_pendente)} para ${pd.tag}`}
                        >
                          <Pencil size={13} /> Lançar Retroativo
                        </button>
                        <button
                          onClick={() => setDescartar(pd)}
                          className="p-1.5 rounded-md hover:bg-red-50 text-omega-400 hover:text-status-vermelho transition-colors"
                          title="Excluir / descartar pendência (inconsistência de frota)"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Formulário da Parte Diária — data + veículo TRAVADOS no retroativo */}
      <ParteDiariaForm
        open={lancar.aberto}
        onClose={fecharForm}
        sessao={sessao}
        veiculos={veiculos}
        inicial={null}
        prefill={lancar.prefill}
        onSalvo={aoSalvarForm}
        onSave={aoSalvarForm}
      />

      {/* Troca manual do operador responsável (override de ADM) */}
      <Modal
        open={!!trocar}
        onClose={fecharTroca}
        title="Trocar operador responsável"
        subtitle={trocar ? `${trocar.tag} • ${trocar.placa || '—'} • ${formatarData(trocar.data_pendente)}` : ''}
        size="md"
        footer={
          <>
            {trocar?.operador_editado && (
              <button
                onClick={restaurarOperadorAutomatico}
                disabled={salvandoOperador}
                className="btn-secondary disabled:opacity-50"
                title="Voltar ao operador derivado do histórico de lançamentos"
              >
                Restaurar automático
              </button>
            )}
            <button onClick={fecharTroca} disabled={salvandoOperador} className="btn-secondary disabled:opacity-50">
              Cancelar
            </button>
            <button
              onClick={confirmarTroca}
              disabled={
                salvandoOperador
                || (!operadorSelecionado && !manualOperador.nome.trim() && !manualOperador.matricula.trim())
              }
              className="btn-primary disabled:opacity-50"
            >
              {salvandoOperador ? 'Salvando...' : 'Confirmar troca'}
            </button>
          </>
        }
      >
        {trocar && (
          <div className="space-y-4">
            <div className="rounded-xl border border-omega-100 bg-omega-50/60 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-omega-500">Atribuição atual</div>
              <div className="mt-0.5 text-sm font-semibold text-omega-900 flex items-center gap-2 flex-wrap">
                {trocar.ultimo_operador_nome || trocar.ultimo_operador_matricula ? (
                  <>
                    {trocar.ultimo_operador_nome || '—'}
                    <span className="text-xs text-omega-500 font-mono">Matr. {trocar.ultimo_operador_matricula || '—'}</span>
                  </>
                ) : (
                  <span className="text-omega-400 italic text-xs">Sem histórico de lançamento</span>
                )}
                {trocar.operador_editado && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-600/20">
                    <Pencil size={9} /> Editado por ADM
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-omega-600 mb-1">Buscar usuário cadastrado</label>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
                <input
                  value={buscaOperador}
                  onChange={(e) => setBuscaOperador(e.target.value)}
                  className="input pl-9"
                  placeholder="Nome, matrícula ou função..."
                />
              </div>
              <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-omega-100 divide-y divide-omega-100">
                {usuariosFiltrados.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-omega-500 text-center">
                    Nenhum usuário encontrado — preencha os campos manuais abaixo.
                  </div>
                ) : (
                  usuariosFiltrados.map((u) => {
                    const ativo = operadorSelecionado?.id === u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setOperadorSelecionado(ativo ? null : u);
                          if (!ativo) setManualOperador({ nome: '', matricula: '' });
                        }}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors ${ativo ? 'bg-blue-50' : 'hover:bg-omega-50'}`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-omega-900 truncate">{u.nome}</span>
                          <span className="block text-[11px] text-omega-500 font-mono">
                            Matr. {u.matricula || '—'}{u.funcao ? ` • ${u.funcao}` : ''}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          {u.tipo === 'OPERACIONAL' ? (
                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-omega-100 text-omega-600">Operacional</span>
                          ) : (
                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Admin</span>
                          )}
                          {ativo && <Check size={15} className="text-blue-600" />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-xl border border-dashed border-omega-200 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-omega-500">
                Ou informe manualmente (usuário não cadastrado)
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  value={manualOperador.nome}
                  onChange={(e) => {
                    setManualOperador((m) => ({ ...m, nome: e.target.value }));
                    setOperadorSelecionado(null);
                  }}
                  className="input"
                  placeholder="Nome do responsável"
                />
                <input
                  value={manualOperador.matricula}
                  onChange={(e) => {
                    setManualOperador((m) => ({ ...m, matricula: e.target.value }));
                    setOperadorSelecionado(null);
                  }}
                  className="input"
                  placeholder="Matrícula"
                />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirmação de descarte */}
      <Modal
        open={!!descartar}
        onClose={() => { if (!descartando) setDescartar(null); }}
        title="Excluir / descartar pendência"
        subtitle={descartar ? `${descartar.tag} • ${descartar.placa || '—'} • ${formatarData(descartar.data_pendente)}` : ''}
        size="sm"
        footer={
          <>
            <button onClick={() => setDescartar(null)} disabled={descartando} className="btn-secondary disabled:opacity-50">Cancelar</button>
            <button onClick={confirmarDescartar} disabled={descartando} className="btn-danger disabled:opacity-50">
              {descartando ? 'Descartando...' : 'Descartar'}
            </button>
          </>
        }
      >
        <p className="text-sm text-omega-700">
          Dispensar esta pendência da auditoria? Use em inconsistências de frota
          (veículo parado, viagem, lançamento em outro sistema). Se uma Parte
          Diária for lançada depois, o descarte é removido automaticamente.
        </p>
      </Modal>

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-xl bg-omega-900 text-white shadow-2xl text-sm font-semibold max-w-md">
          <CheckCircle2 size={17} className="text-status-verde shrink-0" />
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="ml-1 hover:bg-white/15 rounded-full p-0.5">
            <X size={14} />
          </button>
        </div>
      )}

    </div>
  );
}
