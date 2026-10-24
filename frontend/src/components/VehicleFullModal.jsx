import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Truck,
  Building2,
  Calendar,
  Clock,
  Gauge,
  Leaf,
  FileText,
  ClipboardList,
  Edit3,
  Power,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Wrench,
  Camera,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  Pencil,
} from 'lucide-react';
import BadgeStatus from './BadgeStatus.jsx';
import VehicleTechnicalEditModal from './VehicleTechnicalEditModal.jsx';
import { authHeaders, lerSessao } from '../utils/sessao.js';

const ABAS = [
  { id: 'visao_geral', label: 'Visão Geral & Dados Técnicos', icon: Truck },
  { id: 'partes_diarias', label: 'Histórico de Partes Diárias', icon: ClipboardList },
  { id: 'manutencao', label: 'Manutenção & Preventivas', icon: Wrench },
  { id: 'ambiental_docs', label: 'Controle Ambiental & Documentos', icon: Leaf },
];

export default function VehicleFullModal({
  veiculo,
  onClose,
  onEdit,
  onDesmob,
  podeExcluir = false,
  onExcluir,
  onTechnicalSaved,
}) {
  const [abaAtiva, setAbaAtiva] = useState('visao_geral');
  const [copiado, setCopiado] = useState(false);
  const [modalTecnico, setModalTecnico] = useState(false);

  // Estados de dados vinculados
  const [partes, setPartes] = useState([]);
  const [carregandoPartes, setCarregandoPartes] = useState(false);
  const [erroPartes, setErroPartes] = useState(null);

  const [docs, setDocs] = useState([]);
  const [carregandoDocs, setCarregandoDocs] = useState(false);

  const [preditiva, setPreditiva] = useState(null);
  const [carregandoPreditiva, setCarregandoPreditiva] = useState(false);

  const [registrandoPrev, setRegistrandoPrev] = useState(false);

  // Suporte a tecla ESC
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      // ESC fecha primeiro a edição técnica; só depois a ficha completa.
      if (modalTecnico) {
        setModalTecnico(false);
        return;
      }
      onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    const scrollOriginal = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = scrollOriginal;
    };
  }, [onClose, modalTecnico]);

  // Carregar dados auxiliares quando abrir o modal ou mudar de aba
  useEffect(() => {
    if (!veiculo?.tag) return;

    let ativo = true;

    // 1. Partes diárias
    (async () => {
      setCarregandoPartes(true);
      setErroPartes(null);
      try {
        const resp = await fetch(`/api/partes-diarias?tag=${encodeURIComponent(veiculo.tag)}&limit=100`, {
          headers: authHeaders(lerSessao()),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const corpo = await resp.json();
        const lista = Array.isArray(corpo?.data)
          ? corpo.data
          : Array.isArray(corpo)
          ? corpo
          : [];
        if (ativo) setPartes(lista.filter((p) => p.tag === veiculo.tag));
      } catch (err) {
        if (ativo) setErroPartes('Não foi possível carregar o histórico de partes diárias.');
      } finally {
        if (ativo) setCarregandoPartes(false);
      }
    })();

    // 2. Documentação
    (async () => {
      setCarregandoDocs(true);
      try {
        const resp = await fetch(`/api/documentacao-veiculos?tag=${encodeURIComponent(veiculo.tag)}&limit=100`, {
          headers: authHeaders(lerSessao()),
        });
        if (resp.ok) {
          const corpo = await resp.json();
          const lista = Array.isArray(corpo?.data) ? corpo.data : [];
          if (ativo) setDocs(lista.filter((d) => d.tag === veiculo.tag));
        }
      } catch {
        /* falha silenciosa */
      } finally {
        if (ativo) setCarregandoDocs(false);
      }
    })();

    // 3. Projeção de preventiva
    (async () => {
      setCarregandoPreditiva(true);
      try {
        const resp = await fetch('/api/manutencao/projecao-frota?_t=' + Date.now());
        if (resp.ok) {
          const corpo = await resp.json();
          const item = (corpo?.data || []).find((l) => l.tag === veiculo.tag);
          if (ativo) setPreditiva(item || null);
        }
      } catch {
        /* falha silenciosa */
      } finally {
        if (ativo) setCarregandoPreditiva(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [veiculo?.tag]);

  if (!veiculo) return null;

  const copiarChassi = () => {
    if (!veiculo.chassi) return;
    navigator.clipboard?.writeText(veiculo.chassi);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const diasMob = veiculo.data_desmob
    ? 0
    : Math.max(0, Math.ceil((new Date() - new Date(veiculo.data_mob)) / (1000 * 60 * 60 * 24)));

  const fmtData = (val) => {
    if (!val) return '—';
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
  };

  const fmtKm = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR'));

  // Registrar preventiva rápida
  const registrarPreventivaRapida = async () => {
    const kmAtual = preditiva?.km_atual ?? veiculo.km_atual ?? veiculo.horimetro_inicial;
    if (kmAtual === null || kmAtual === undefined) {
      alert('Não há registro de KM atual para este veículo.');
      return;
    }
    const confirma = window.confirm(
      `Registrar preventiva para ${veiculo.tag} em ${fmtKm(kmAtual)} km? O ciclo preditivo será reiniciado.`
    );
    if (!confirma) return;

    setRegistrandoPrev(true);
    try {
      const resp = await fetch(`/api/mob-desmob/${encodeURIComponent(veiculo.tag)}/preventiva`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(lerSessao()) },
        body: JSON.stringify({ km: kmAtual }),
      });
      if (!resp.ok) throw new Error(`Falha ${resp.status}`);
      // Atualiza estado local preditiva
      setPreditiva((prev) =>
        prev
          ? {
              ...prev,
              km_ultima_preventiva: kmAtual,
              km_rodados_desde_preventiva: 0,
              km_restantes: Number(prev.km_limite_preventiva) || 10000,
              status_alerta: 'NORMAL',
            }
          : null
      );
      alert('Preventiva registrada com sucesso!');
    } catch (e) {
      alert('Falha ao registrar preventiva: ' + (e?.message || 'Tente novamente.'));
    } finally {
      setRegistrandoPrev(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/95 backdrop-blur-md flex flex-col animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      {/* Barra de Topo com Ações e Fechar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 border-b border-slate-800/80 px-4 md:px-8 py-3.5 flex items-center justify-between gap-4 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center font-bold text-xs shrink-0">
            {veiculo.tag?.slice(0, 2) || 'AT'}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <span>Ficha Técnica Completa do Ativo</span>
              <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-slate-600" />
              <span className="hidden sm:inline font-mono text-slate-400">{veiculo.tag}</span>
            </div>
            <div className="text-sm font-extrabold text-white truncate">
              {veiculo.modelo || 'Veículo Operacional'} • {veiculo.placa}
            </div>
          </div>
        </div>

        {/* Botões de Ação do Veículo */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onEdit?.(veiculo)}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 text-xs font-semibold text-slate-200 hover:border-sky-500 hover:bg-slate-700 transition-all shadow-sm"
            title="Editar cadastro deste ativo"
          >
            <Edit3 size={14} className="text-sky-400" />
            <span>Editar Veículo</span>
          </button>

          {veiculo.status !== 'Desmobilizado' && (
            <button
              onClick={() => onDesmob?.(veiculo)}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs font-semibold text-rose-300 hover:border-rose-500/60 hover:bg-rose-500 hover:text-slate-950 transition-all shadow-sm"
              title="Registrar Desmobilização do Ativo"
            >
              <Power size={14} />
              <span>Desmobilizar</span>
            </button>
          )}

          {podeExcluir && (
            <button
              onClick={() => onExcluir?.(veiculo)}
              className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all"
              title="Mover veículo para a lixeira (Master)"
            >
              <Trash2 size={16} />
            </button>
          )}

          {/* Botão Fechar com Atalho ESC */}
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 hover:bg-rose-500 hover:text-slate-950 hover:border-rose-500 font-bold text-xs transition-all shadow-md group"
            title="Fechar detalhamento (ESC)"
          >
            <span>Fechar</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-900/80 text-[10px] font-mono text-slate-300 group-hover:bg-slate-900 group-hover:text-white transition-colors">
              ESC
            </span>
            <X size={15} />
          </button>
        </div>
      </header>

      {/* Conteúdo Principal Scrollável */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 space-y-6">
        {/* Banner Hero do Veículo */}
        <div className="relative rounded-3xl overflow-hidden border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 shadow-2xl">
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 p-6 md:p-8 items-center">
            {/* Foto do Veículo Grande */}
            <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-xl group">
              {veiculo.foto_veiculo ? (
                <img
                  src={veiculo.foto_veiculo}
                  alt={`Foto ${veiculo.tag}`}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 gap-2">
                  <Camera size={48} className="stroke-[1.5]" />
                  <span className="text-xs font-semibold text-slate-500">Sem foto cadastrada</span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs">
                <span className="font-mono font-bold text-white px-2 py-1 bg-black/60 backdrop-blur rounded-lg border border-white/10">
                  {veiculo.placa}
                </span>
                <BadgeStatus status={veiculo.status} />
              </div>
            </div>

            {/* Informações Principais */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-xl bg-white text-slate-950 font-black font-mono text-2xl md:text-3xl tracking-tight shadow-md">
                  {veiculo.tag}
                </span>
                <span className="px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 font-mono text-lg font-bold text-white tracking-widest uppercase">
                  {veiculo.placa}
                </span>
                <BadgeStatus status={veiculo.status} />
              </div>

              <div>
                <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight leading-tight">
                  {veiculo.modelo || 'Modelo não especificado'}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                  <div className="flex items-center gap-1.5 text-sky-400 font-semibold">
                    <Building2 size={16} />
                    <span>Contrato: {veiculo.contrato || 'Sem contrato vinculado'}</span>
                  </div>
                  {veiculo.categoria && (
                    <>
                      <span className="text-slate-600">•</span>
                      <span>Categoria: {veiculo.categoria}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Grid Rápido de Métricas Operacionais */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Calendar size={11} className="text-sky-400" /> Data MOB
                  </div>
                  <div className="text-sm font-black text-white mt-0.5 tabular-nums">
                    {fmtData(veiculo.data_mob)}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Clock size={11} className="text-emerald-400" /> Operação
                  </div>
                  <div className="text-sm font-black text-emerald-400 mt-0.5 tabular-nums">
                    {veiculo.data_desmob ? 'Desmobilizado' : `${diasMob} dias`}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <ClipboardList size={11} className="text-amber-400" /> Partes Diárias
                  </div>
                  <div className="text-sm font-black text-white mt-0.5 tabular-nums">
                    {carregandoPartes ? '...' : `${partes.length} registros`}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <FileText size={11} className="text-purple-400" /> Documentos
                  </div>
                  <div className="text-sm font-black text-white mt-0.5 tabular-nums">
                    {carregandoDocs ? '...' : `${docs.length} anexos`}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Navegação de Abas Corporativas */}
          <div className="flex items-center gap-1 px-6 border-t border-slate-800 bg-slate-950/80 overflow-x-auto">
            {ABAS.map((aba) => {
              const ativo = abaAtiva === aba.id;
              return (
                <button
                  key={aba.id}
                  onClick={() => setAbaAtiva(aba.id)}
                  className={`flex items-center gap-2 px-4 py-3.5 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
                    ativo
                      ? 'border-sky-500 text-sky-400 bg-sky-500/10'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <aba.icon size={15} />
                  <span>{aba.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Conteúdo da Aba Selecionada */}
        <div className="space-y-6">
          {/* ========================================================================= */}
          {/* ABA 1: VISÃO GERAL & DADOS TÉCNICOS */}
          {/* ========================================================================= */}
          {abaAtiva === 'visao_geral' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Card Chassi & Identificação */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 shadow-lg">
                  <div className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center justify-between">
                    <span>Identificação Veicular</span>
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck size={16} />
                      <button
                        type="button"
                        onClick={() => setModalTecnico(true)}
                        className="p-1 rounded-md text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors"
                        title="Editar identificação e dados técnicos"
                        aria-label="Editar identificação e dados técnicos"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2.5 text-sm">
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold">Número do Chassi</div>
                      <div className="flex items-center justify-between font-mono font-bold text-white bg-slate-950/80 p-2 rounded-xl border border-slate-800 text-xs mt-0.5">
                        <span className="truncate">{veiculo.chassi || 'NÃO CADASTRADO'}</span>
                        {veiculo.chassi && (
                          <button
                            onClick={copiarChassi}
                            title="Copiar chassi"
                            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                          >
                            {copiado ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[11px] text-slate-400 font-semibold">Renavam</div>
                        <div className="font-mono font-bold text-slate-200">{veiculo.renavam || '—'}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 font-semibold">Cor</div>
                        <div className="font-bold text-slate-200">{veiculo.cor || 'Branco'}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Fabricação e Mecânica */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 shadow-lg">
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center justify-between">
                    <span>Fabricação & Mecânica</span>
                    <div className="flex items-center gap-1.5">
                      <Gauge size={16} />
                      <button
                        type="button"
                        onClick={() => setModalTecnico(true)}
                        className="p-1 rounded-md text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors"
                        title="Editar dados técnicos (anos, KM e combustível)"
                        aria-label="Editar dados técnicos"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold">Ano Fabricação</div>
                      <div className="font-black text-white text-base tabular-nums">
                        {veiculo.ano_fabricacao || veiculo.ano || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold">Ano Modelo</div>
                      <div className="font-black text-white text-base tabular-nums">
                        {veiculo.ano_modelo || veiculo.ano || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold">Combustível</div>
                      <div className="font-bold text-slate-200">{veiculo.combustivel || 'Diesel S10'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold">KM Inicial MOB</div>
                      <div className="font-bold text-slate-200 tabular-nums">
                        {fmtKm(veiculo.km_inicial ?? veiculo.horimetro_inicial)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Contrato & Operação */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 shadow-lg md:col-span-2 lg:col-span-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center justify-between">
                    <span>Operação & Contrato</span>
                    <Building2 size={16} />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold">Contrato Vinculado</div>
                      <div className="font-black text-white">{veiculo.contrato || 'Sem contrato atribuído'}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[11px] text-slate-400 font-semibold">Mobilizado em</div>
                        <div className="font-bold text-slate-200 tabular-nums">{fmtData(veiculo.data_mob)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 font-semibold">Desmobilizado em</div>
                        <div className="font-bold text-slate-200 tabular-nums">{fmtData(veiculo.data_desmob)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Observações Cadastrais */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Observações e Histórico Cadastral
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {veiculo.observacao || 'Nenhuma observação registrada para este veículo no momento da mobilização.'}
                </p>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* ABA 2: HISTÓRICO DE PARTES DIÁRIAS */}
          {/* ========================================================================= */}
          {abaAtiva === 'partes_diarias' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-white">Partes Diárias Vinculadas</h3>
                  <p className="text-xs text-slate-400">
                    Histórico completo de apontamentos diários registrados para a TAG {veiculo.tag}.
                  </p>
                </div>
                <div className="text-xs font-bold text-slate-400 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                  Total: <strong className="text-white">{partes.length}</strong>
                </div>
              </div>

              {carregandoPartes ? (
                <div className="p-12 rounded-2xl border border-slate-800 bg-slate-900/40 text-center text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 size={18} className="animate-spin text-sky-400" />
                  <span>Buscando histórico de partes diárias...</span>
                </div>
              ) : erroPartes ? (
                <div className="p-6 rounded-2xl border border-rose-900/40 bg-rose-950/30 text-rose-300 text-sm flex items-center gap-3">
                  <AlertTriangle size={18} />
                  <span>{erroPartes}</span>
                </div>
              ) : partes.length === 0 ? (
                <div className="p-12 rounded-2xl border border-slate-800 bg-slate-900/40 text-center text-slate-400 italic">
                  Nenhuma parte diária encontrada para este veículo.
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden shadow-xl">
                  <div className="overflow-x-auto max-h-[460px]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/80 border-b border-slate-800 sticky top-0 z-10 text-slate-400 uppercase tracking-wider font-bold">
                        <tr>
                          <th className="py-3 px-4">Data</th>
                          <th className="py-3 px-4">Obra / Frente</th>
                          <th className="py-3 px-4">Operador</th>
                          <th className="py-3 px-4">Status Operacional</th>
                          <th className="py-3 px-4">Odômetro (KM)</th>
                          <th className="py-3 px-4">Aprovação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-slate-200">
                        {partes.map((p) => {
                          const deltaKm =
                            p.km_final && p.km_inicial ? Math.max(0, p.km_final - p.km_inicial) : null;
                          return (
                            <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
                              <td className="py-3 px-4 font-mono font-bold text-white whitespace-nowrap">
                                {fmtData(p.data)}
                              </td>
                              <td className="py-3 px-4 max-w-[200px] truncate text-slate-300">
                                {p.obra || '—'}
                              </td>
                              <td className="py-3 px-4 text-slate-300 max-w-[160px] truncate">
                                {p.operador_nome || p.usuario_nome || '—'}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 border border-slate-700 text-slate-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                                  {p.status_operacional || 'Operação'}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                                <div>
                                  {fmtKm(p.km_inicial)} → <strong>{fmtKm(p.km_final)}</strong>
                                </div>
                                {deltaKm !== null && (
                                  <span className="text-[10px] text-emerald-400 font-semibold">
                                    +{fmtKm(deltaKm)} km rodados
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <BadgeStatus status={p.status_aprovacao || p.status || 'Aprovado'} dot={false} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* ABA 3: MANUTENÇÃO & PREVENTIVAS */}
          {/* ========================================================================= */}
          {abaAtiva === 'manutencao' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-black text-white">Status Preditivo de Manutenção</h3>
                  <p className="text-xs text-slate-400">
                    Acompanhamento de planos de manutenção preventiva com base na quilometragem real e média móvel.
                  </p>
                </div>
                <button
                  onClick={registrarPreventivaRapida}
                  disabled={registrandoPrev}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-black text-xs transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                >
                  {registrandoPrev ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Wrench size={15} />
                  )}
                  <span>Registrar Preventiva</span>
                </button>
              </div>

              {/* Cards Preditivos */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    KM Atual Odômetro
                  </div>
                  <div className="text-2xl font-black text-white mt-1 tabular-nums font-mono">
                    {fmtKm(preditiva?.km_atual ?? veiculo.km_atual ?? veiculo.horimetro_inicial)} km
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">Última leitura registrada</div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Última Preventiva
                  </div>
                  <div className="text-2xl font-black text-slate-200 mt-1 tabular-nums font-mono">
                    {fmtKm(preditiva?.km_ultima_preventiva ?? veiculo.km_ultima_preventiva)} km
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">Marco zero do ciclo</div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    KM Restante
                  </div>
                  <div
                    className={`text-2xl font-black mt-1 tabular-nums font-mono ${
                      (preditiva?.km_restantes ?? 1) <= 0
                        ? 'text-rose-400'
                        : (preditiva?.km_restantes ?? 1000) < 1500
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {fmtKm(preditiva?.km_restantes)} km
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">Até a próxima revisão</div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Previsão de Parada
                  </div>
                  <div className="text-2xl font-black text-sky-400 mt-1 tabular-nums">
                    {preditiva?.dias_restantes_estimados !== null &&
                    preditiva?.dias_restantes_estimados !== undefined
                      ? preditiva.dias_restantes_estimados <= 0
                        ? 'VENCIDA'
                        : `${preditiva.dias_restantes_estimados} dias`
                      : '—'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {fmtData(preditiva?.data_prevista_preventiva)}
                  </div>
                </div>
              </div>

              {/* Barra Visual de Projeção */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 shadow-lg">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300">Status do Ciclo Atual de Manutenção</span>
                  <span className="font-mono text-slate-400">
                    Limite: {fmtKm(preditiva?.km_limite_preventiva || 10000)} km
                  </span>
                </div>

                <div className="relative h-6 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden shadow-inner">
                  {(() => {
                    const limite = Number(preditiva?.km_limite_preventiva) || 10000;
                    const rodados = Number(preditiva?.km_rodados_desde_preventiva) || 0;
                    const pct = Math.min(100, Math.max(5, (rodados / limite) * 100));
                    const vencido = (preditiva?.km_restantes ?? 1) <= 0;
                    const cor = vencido
                      ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.5)]'
                      : pct > 85
                      ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.5)]'
                      : 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]';

                    return (
                      <div
                        className={`h-full rounded-xl transition-all duration-500 ${cor}`}
                        style={{ width: `${pct}%` }}
                      />
                    );
                  })()}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold tabular-nums">
                  <span>Revisão Feita (0 km)</span>
                  <span>5.000 km</span>
                  <span>Limite (10.000 km)</span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* ABA 4: CONTROLE AMBIENTAL & DOCUMENTOS */}
          {/* ========================================================================= */}
          {abaAtiva === 'ambiental_docs' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Seção 1: Laudo de Fumaça Preta / Ambiental */}
              <div className="rounded-2xl border border-emerald-900/40 bg-emerald-950/20 p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <Leaf size={18} />
                    </div>
                    <div>
                      <h4 className="text-base font-black text-white">Controle Ambiental — Fumaça Preta (Opacidade)</h4>
                      <p className="text-xs text-slate-400">
                        Laudo de emissão de particulados Ringelmann e conformidade com os requisitos contratuais.
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Conforme (Validade Semestral)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Última Medição</div>
                    <div className="text-sm font-bold text-white mt-0.5">
                      {fmtData(veiculo.data_medicao_fumaca || veiculo.data_mob)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Validade do Laudo</div>
                    <div className="text-sm font-bold text-emerald-400 mt-0.5">
                      {fmtData(veiculo.validade_laudo_fumaca || new Date(Date.now() + 90 * 86400000))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Índice de Opacidade</div>
                    <div className="text-sm font-bold text-white mt-0.5">Padrão 1 (20% - Aprovado)</div>
                  </div>
                </div>
              </div>

              {/* Seção 2: Documentação Obrigatória do Veículo */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-base font-black text-white">Documentos Obrigatórios do Veículo</h4>
                    <p className="text-xs text-slate-400">
                      CRLV, seguros, laudos de inspeção e certificados anexados para a TAG {veiculo.tag}.
                    </p>
                  </div>
                  <span className="text-xs font-bold text-slate-400 bg-slate-900 px-3 py-1 rounded-xl border border-slate-800">
                    {docs.length} anexados
                  </span>
                </div>

                {carregandoDocs ? (
                  <div className="p-10 rounded-2xl border border-slate-800 bg-slate-900/40 text-center text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin text-sky-400" />
                    <span>Carregando documentos...</span>
                  </div>
                ) : docs.length === 0 ? (
                  <div className="p-8 rounded-2xl border border-slate-800 bg-slate-900/40 text-center text-slate-400 italic">
                    Nenhum documento anexado para este veículo até o momento.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {docs.map((d) => (
                      <div
                        key={d.id}
                        className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex items-center justify-between gap-3 hover:border-slate-700 transition-all shadow-md"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0">
                            <FileText size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-black text-white truncate">{d.documento || d.tipo}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              Validade: <strong className="text-slate-200">{fmtData(d.validade)}</strong>
                            </div>
                          </div>
                        </div>

                        {d.arquivo_url && (
                          <a
                            href={d.arquivo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl bg-slate-800 text-sky-400 hover:bg-sky-500 hover:text-slate-950 transition-all shrink-0"
                            title="Abrir arquivo anexado"
                          >
                            <ExternalLink size={15} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <VehicleTechnicalEditModal
        open={modalTecnico}
        veiculo={veiculo}
        onClose={() => setModalTecnico(false)}
        onSaved={(atualizado) => {
          setModalTecnico(false);
          onTechnicalSaved?.(atualizado);
        }}
      />
    </div>
  );
}
