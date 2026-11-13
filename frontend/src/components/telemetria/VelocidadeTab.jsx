// Aba "Excesso de Velocidade": linhas da plataforma agrupadas em ocorrências (mesmo
// veículo, até 2 min), farol do gatilho de 10 s (PGS-007245, item 7.1), faixas e
// recorrência da Matriz de Avaliação de Condutas (Anexo I), mapa, cercas, horário,
// histórico do condutor e planos de ação.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Clock,
  ClipboardList,
  Gauge,
  Info,
  Loader2,
  MapPin,
  OctagonAlert,
  ShieldAlert,
  Timer,
  TriangleAlert,
  Users,
} from 'lucide-react';
import StatCard from '../StatCard.jsx';
import MapaOcorrencias from './MapaOcorrencias.jsx';
import ModalPlanoAcao from './ModalPlanoAcao.jsx';
import PainelCondutor from './PainelCondutor.jsx';
import {
  FAIXA_VELOCIDADE,
  FAROL_VELOCIDADE,
  ROTULO_LINHA_MATRIZ,
  STATUS_PLANO,
  apiTelemetria,
  formatarData,
  formatarDataHora,
  formatarDuracao,
  ordinal,
} from '../../utils/telemetriaApi.js';

const FILTROS_FAROL = [
  { id: '', label: 'Com conduta' },
  { id: 'CONFIRMADA', label: 'Confirmados' },
  { id: 'ABAIXO_GATILHO', label: 'Abaixo de 10 s' },
  { id: 'TOLERANCIA', label: 'Tolerância (≤7%)' },
  { id: 'DESCARTADA', label: 'Descartados' },
];
const FILTROS_FAIXA = [
  { id: '', label: 'Todas as faixas' },
  { id: 'MODERADO', label: 'Moderado' },
  { id: 'GRAVE', label: 'Significativo' },
  { id: 'CRITICO', label: 'Crítico' },
];

export function SeloVelocidade({ classificacao, manual }) {
  const f = FAROL_VELOCIDADE[classificacao] || FAROL_VELOCIDADE.ABAIXO_GATILHO;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${f.classe}`} title={f.descricao}>
      <span className="h-2 w-2 rounded-full" style={{ background: f.cor }} />
      {f.curto}
      {manual && <span className="font-normal opacity-70">(Central)</span>}
    </span>
  );
}

export function SeloFaixa({ faixa }) {
  const f = FAIXA_VELOCIDADE[faixa] || FAIXA_VELOCIDADE.NORMAL;
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: f.cor }} title={f.faixa}>
      {f.label}{f.classificacao ? ` · ${f.classificacao}` : ''}
    </span>
  );
}

function MatrizVelocidade({ matriz }) {
  if (!matriz) return null;
  const linhas = ['MODERADO', 'GRAVE', 'CRITICO'].map((f) => matriz[f]).filter(Boolean);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-[11px]">
        <thead className="bg-teal-700 text-white">
          <tr>{['Tipo de evento', 'Potencial severidade', 'Classificação', '01 evento', '02 eventos', '03 ou mais eventos'].map((t) => <th key={t} className="border border-teal-800 px-2 py-1.5 font-bold">{t}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.titulo}>
              <td className="border border-omega-200 bg-slate-100 px-2 py-1.5 font-semibold text-omega-800">{l.titulo}</td>
              <td className="border border-omega-200 px-2 text-center">{l.severidade}</td>
              <td className="border border-omega-200 px-2 text-center">{l.classificacao}</td>
              {l.medidas.map((m, i) => (
                <td key={i} className={`border border-omega-200 px-2 py-1.5 text-center ${m.includes('Comitê') ? 'bg-red-100 text-red-800' : 'text-omega-700'}`}>{m}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BarrasHora({ porHora }) {
  const max = Math.max(1, ...porHora.map((h) => h.ocorrencias));
  return (
    <div className="flex h-32 items-stretch gap-0.5" role="img" aria-label="Ocorrências por hora do dia">
      {porHora.map((h) => (
        <div key={h.hora} className="group relative flex flex-1 flex-col items-center">
          {/* Altura em px a partir da área útil (112 px): % não funciona sem altura definida no pai. */}
          <div className="flex w-full flex-1 flex-col justify-end">
            <div className="flex w-full flex-col justify-end overflow-hidden rounded-t bg-amber-300" style={{ height: `${Math.round((h.ocorrencias / max) * 112)}px` }}>
              <div className="w-full bg-status-vermelho" style={{ height: `${h.ocorrencias ? Math.round((h.confirmadas / max) * 112) : 0}px` }} />
            </div>
          </div>
          <span className="mt-1 h-3 text-[9px] text-omega-400">{h.hora % 3 === 0 ? `${String(h.hora).padStart(2, '0')}h` : ''}</span>
          <span className="pointer-events-none absolute bottom-full mb-1 hidden whitespace-nowrap rounded bg-omega-900 px-1.5 py-0.5 text-[10px] text-white group-hover:block">
            {String(h.hora).padStart(2, '0')}h: {h.ocorrencias} ({h.confirmadas} confirmadas)
          </span>
        </div>
      ))}
    </div>
  );
}

export default function VelocidadeTab({ semanas, podeGerenciar, pronto = true }) {
  const [dados, setDados] = useState(null);
  const [planos, setPlanos] = useState([]);
  const [matriz, setMatriz] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [farol, setFarol] = useState('');
  const [faixa, setFaixa] = useState('');
  const [selecionadas, setSelecionadas] = useState([]);
  const [versao, setVersao] = useState(0);
  const [condutor, setCondutor] = useState(null);
  const [planoCtx, setPlanoCtx] = useState(null);
  const [validando, setValidando] = useState(null);
  const [mostrarMatriz, setMostrarMatriz] = useState(false);
  const [limiteLista, setLimiteLista] = useState(100);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (semanas) params.set('semanas', semanas);
      const [analise, listaPlanos] = await Promise.all([
        apiTelemetria(`/velocidade?${params}`, { erro: 'Falha ao carregar a analise de velocidade' }),
        apiTelemetria('/planos?tipo=VELOCIDADE', { erro: 'Falha ao carregar os planos de acao' }),
      ]);
      setDados(analise);
      setPlanos(listaPlanos.planos || []);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [semanas]);

  useEffect(() => { if (pronto) carregar(); }, [carregar, versao, pronto]);
  useEffect(() => { setSelecionadas([]); setLimiteLista(100); }, [semanas, farol, faixa]);
  useEffect(() => {
    apiTelemetria('/matriz-velocidade').then((r) => setMatriz(r.matriz)).catch(() => {});
  }, []);

  // Matriz no formato do modal de plano (linhas VELOCIDADE_<FAIXA>).
  const matrizPlano = useMemo(() => (matriz ? Object.fromEntries(Object.entries(matriz).map(([f, l]) => [`VELOCIDADE_${f}`, l])) : null), [matriz]);

  const recarregar = () => setVersao((v) => v + 1);
  const ocorrencias = dados?.ocorrencias || [];
  const visiveis = useMemo(() => ocorrencias.filter((o) => {
    if (farol ? o.classificacao !== farol : o.faixa === 'NORMAL') return false;
    return !faixa || o.faixa === faixa;
  }), [ocorrencias, farol, faixa]);
  const k = dados?.kpis;
  const porClasse = k?.por_classificacao || {};
  const escolhidas = ocorrencias.filter((o) => selecionadas.includes(o.chave));
  const condutoresEscolhidos = [...new Set(escolhidas.map((o) => o.motorista))];

  async function validar(o, decisao) {
    let motivo;
    if (decisao === 'DESCARTADA') {
      motivo = window.prompt('Motivo do descarte (ex.: veículo de emergência, falha de GPS, uso como benefício comprovado):');
      if (!motivo) return;
    }
    setValidando(o.chave);
    try {
      await apiTelemetria('/velocidade/validacao', { metodo: 'PATCH', corpo: { ids: o.ids, decisao, motivo }, erro: 'Falha ao validar' });
      recarregar();
    } catch (e) {
      alert(e.message);
    } finally {
      setValidando(null);
    }
  }

  function abrirPlanoNovo(lista) {
    if (!lista[0]?.motorista) return;
    setCondutor(null);
    setPlanoCtx({ tipo: 'VELOCIDADE', motorista: lista[0].motorista, tag_placa: lista[0].tag_placa, ocorrencias: lista });
  }

  return (
    <div className="space-y-6">
      {erro && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-status-vermelho">
          <AlertCircle size={16} className="shrink-0" /> {erro}
        </div>
      )}

      <div className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex items-start gap-2 text-sm text-omega-700 lg:max-w-md">
          <Info size={18} className="mt-0.5 shrink-0 text-omega-accent" />
          <p>
            Linhas da plataforma do mesmo veículo a até <strong>2 min</strong> formam <strong>uma ocorrência</strong>, que vale pelo pior ponto
            (maior % acima do limite da cerca) e pela soma das durações. Só ocorrências confirmadas contam na matriz.
          </p>
        </div>
        <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {['CONFIRMADA', 'ABAIXO_GATILHO', 'TOLERANCIA', 'DESCARTADA'].map((c) => (
            <div key={c} className="rounded-xl border border-omega-100 p-2 text-[11px] leading-snug text-omega-600">
              <SeloVelocidade classificacao={c} />
              <p className="mt-1">{FAROL_VELOCIDADE[c].descricao}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1700px]:grid-cols-6">
        <StatCard title="Ocorrências" value={k?.ocorrencias ?? 0} icon={Gauge} iconBg="bg-omega-900" sub={`${k?.linhas ?? 0} linhas da plataforma`} />
        <StatCard title="Moderado · N5" value={k?.confirmadas_por_faixa?.MODERADO ?? 0} icon={TriangleAlert} iconBg="bg-amber-500" sub=">7% e ≤20%, confirmados" />
        <StatCard title="Significativo · N3" value={k?.confirmadas_por_faixa?.GRAVE ?? 0} icon={ShieldAlert} iconBg="bg-orange-500" sub=">20% e ≤50%, confirmados" />
        <StatCard title="Crítico · N3" value={k?.confirmadas_por_faixa?.CRITICO ?? 0} icon={OctagonAlert} iconBg="bg-status-vermelho" sub=">50% ou >120 km/h" />
        <StatCard title="Abaixo de 10 s" value={porClasse.ABAIXO_GATILHO ?? 0} icon={Timer} iconBg="bg-status-amarelo" sub="Validar pela Central" />
        <StatCard title="Condutores em Comitê" value={k?.condutores_comite ?? 0} icon={Users} iconBg="bg-omega-red-600" sub={`${k?.confirmadas_sem_plano ?? 0} confirmadas sem plano`} />
      </div>

      <div className="grid grid-cols-1 gap-6 min-[1500px]:grid-cols-3">
        <div className="card p-4 min-[1500px]:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <MapPin size={16} className="text-omega-accent" />
            <h3 className="font-bold text-omega-900">Mapa dos excessos</h3>
            <span className="text-xs text-omega-500">cor = faixa do Anexo I (cinza: não confirmados)</span>
            {carregando && <Loader2 size={14} className="animate-spin text-omega-400" />}
          </div>
          <MapaOcorrencias
            ocorrencias={visiveis}
            onSelecionar={(o) => setCondutor(o.motorista)}
            farois={FAROL_VELOCIDADE}
            corDe={(o) => (o.classificacao === 'CONFIRMADA' ? FAIXA_VELOCIDADE[o.faixa]?.cor : FAROL_VELOCIDADE[o.classificacao]?.cor)}
            legenda={[
              { cor: FAIXA_VELOCIDADE.CRITICO.cor, rotulo: 'Crítico' },
              { cor: FAIXA_VELOCIDADE.GRAVE.cor, rotulo: 'Significativo' },
              { cor: FAIXA_VELOCIDADE.MODERADO.cor, rotulo: 'Moderado' },
              { cor: FAROL_VELOCIDADE.ABAIXO_GATILHO.cor, rotulo: 'Abaixo de 10 s' },
            ]}
            detalhe={(o) => `${Math.round(o.velocidade)} / ${Math.round(o.limite)} km/h (+${o.percentual_excesso}%) · ${formatarDuracao(o.duracao_total_s)}`}
          />
        </div>
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Users size={16} className="text-status-vermelho" />
            <h3 className="font-bold text-omega-900">Condutores — recorrência no mês</h3>
          </div>
          <ul className="max-h-[380px] space-y-2 overflow-y-auto">
            {(dados?.ranking_condutores || []).map((r) => (
              <li key={r.motorista || r.placa}>
                <button type="button" onClick={() => r.motorista && setCondutor(r.motorista)} className="w-full rounded-xl border border-omega-100 p-2.5 text-left hover:bg-omega-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-omega-900">{r.motorista || 'Não identificado'}</span>
                    {r.comite
                      ? <span className="shrink-0 rounded-md bg-status-vermelho px-2 py-0.5 text-[10px] font-extrabold text-white">COMITÊ</span>
                      : <span className="shrink-0 text-xs font-bold text-omega-600">{r.confirmadas}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-bold">
                    {['MODERADO', 'GRAVE', 'CRITICO'].filter((f) => r[f]).map((f) => (
                      <span key={f} className="rounded px-1.5 py-0.5 text-white" style={{ background: FAIXA_VELOCIDADE[f].cor }}>{r[f]} {FAIXA_VELOCIDADE[f].label}</span>
                    ))}
                    {r.sem_plano ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">{r.sem_plano} sem plano</span> : null}
                  </div>
                </button>
              </li>
            ))}
            {!dados?.ranking_condutores?.length && <li className="rounded-xl border border-dashed border-omega-200 p-4 text-center text-sm text-omega-500">Nenhum excesso confirmado no período.</li>}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-omega-900"><MapPin size={16} className="text-omega-accent" /> Cercas com mais excessos</h3>
          <p className="mb-3 text-xs text-omega-500">Muitos condutores na mesma cerca podem indicar problema de trecho ou sinalização (PGS, item 7.2), além de conduta.</p>
          <table className="w-full text-xs">
            <thead className="text-left font-semibold uppercase tracking-wider text-omega-500">
              <tr><th className="py-1.5">Cerca</th><th className="py-1.5 text-center">Limite</th><th className="py-1.5 text-center">Ocorrências</th><th className="py-1.5 text-center">Confirmadas</th><th className="py-1.5 text-center">Condutores</th></tr>
            </thead>
            <tbody className="divide-y divide-omega-100">
              {(dados?.cercas || []).map((c) => (
                <tr key={`${c.cerca}|${c.limite}`}>
                  <td className="py-1.5 font-semibold text-omega-800">{c.cerca}</td>
                  <td className="py-1.5 text-center">{c.limite ? `${Math.round(c.limite)} km/h` : '—'}</td>
                  <td className="py-1.5 text-center font-bold">{c.ocorrencias}</td>
                  <td className="py-1.5 text-center text-status-vermelho">{c.confirmadas}</td>
                  <td className={`py-1.5 text-center ${c.condutores >= 3 ? 'font-bold text-orange-600' : ''}`}>{c.condutores}</td>
                </tr>
              ))}
              {!dados?.cercas?.length && <tr><td colSpan={5} className="py-4 text-center text-omega-500">Sem dados.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card p-5">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-omega-900"><Clock size={16} className="text-omega-accent" /> Horário dos excessos</h3>
          <p className="mb-3 text-xs text-omega-500">Ocorrências com conduta por hora do dia (vermelho: confirmadas; amarelo: abaixo de 10 s).</p>
          <BarrasHora porHora={dados?.por_hora || Array.from({ length: 24 }, (_, hora) => ({ hora, ocorrencias: 0, confirmadas: 0 }))} />
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center">
          <h3 className="font-bold text-omega-900">Ocorrências de excesso de velocidade</h3>
          <div className="flex flex-wrap gap-2">
            {FILTROS_FAROL.map((f) => (
              <button key={f.id || 'conduta'} type="button" onClick={() => setFarol(f.id)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${farol === f.id ? 'bg-omega-900 text-white' : 'bg-omega-100 text-omega-700 hover:bg-omega-200'}`}>
                {f.label}{f.id ? ` (${porClasse[f.id] ?? 0})` : ''}
              </button>
            ))}
            <select className="input w-auto py-1 text-xs" value={faixa} onChange={(e) => setFaixa(e.target.value)} aria-label="Faixa">
              {FILTROS_FAIXA.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>

        {podeGerenciar && escolhidas.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
            <span className="font-bold text-blue-800">
              {escolhidas.length} ocorrência(s) de {condutoresEscolhidos.length} condutor(es)
              {condutoresEscolhidos.length > 1 && <span className="font-normal"> — o plano de ação é por condutor; selecione um só.</span>}
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setSelecionadas([])}>Limpar</button>
              <button type="button" className="btn-omega-red px-3 py-1.5 text-xs" disabled={condutoresEscolhidos.length !== 1 || !condutoresEscolhidos[0]} onClick={() => abrirPlanoNovo(escolhidas)}>
                <ClipboardList size={14} /> Montar plano de ação
              </button>
            </div>
          </div>
        )}

        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-omega-50 text-left text-xs font-semibold uppercase tracking-wider text-omega-500">
              <tr>
                {podeGerenciar && <th className="w-8 rounded-tl-xl py-3 pl-3" />}
                <th className={`py-3 pr-3 ${podeGerenciar ? '' : 'rounded-tl-xl pl-3'}`}>Farol</th>
                <th className="py-3 pr-3">Data / hora</th>
                <th className="py-3 pr-3">Condutor</th>
                <th className="py-3 pr-3">TAG x Placa</th>
                <th className="py-3 pr-3">Pior ponto</th>
                <th className="py-3 pr-3">Duração</th>
                <th className="py-3 pr-3">Faixa</th>
                <th className="py-3 pr-3">Recorrência / medida</th>
                <th className="rounded-tr-xl py-3 pr-3 text-right">Plano / validação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-omega-100">
              {visiveis.slice(0, limiteLista).map((o) => {
                const selecionavel = podeGerenciar && o.motorista && !o.plano_acao_id && o.classificacao === 'CONFIRMADA';
                return (
                  <tr key={o.chave} className={`cursor-pointer align-top ${selecionadas.includes(o.chave) ? 'bg-blue-50' : 'hover:bg-omega-50'}`} onClick={() => o.motorista && setCondutor(o.motorista)}>
                    {podeGerenciar && (
                      <td className="py-3 pl-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Selecionar ocorrência para plano de ação"
                          className="h-4 w-4 rounded border-omega-300 disabled:opacity-30"
                          disabled={!selecionavel}
                          title={selecionavel ? '' : 'Só excesso confirmado, de condutor identificado e sem plano, entra em plano de ação'}
                          checked={selecionadas.includes(o.chave)}
                          onChange={() => setSelecionadas((s) => (s.includes(o.chave) ? s.filter((c) => c !== o.chave) : [...s, o.chave]))}
                        />
                      </td>
                    )}
                    <td className={`py-3 pr-3 ${podeGerenciar ? '' : 'pl-3'}`}><SeloVelocidade classificacao={o.classificacao} manual={o.validada_manualmente} /></td>
                    <td className="whitespace-nowrap py-3 pr-3 tabular-nums text-omega-700">
                      {formatarDataHora(o.inicio)}
                      {o.linhas.length > 1 && <div className="text-[11px] text-omega-500">{o.linhas.length} linhas agrupadas</div>}
                    </td>
                    <td className="max-w-[200px] py-3 pr-3 font-semibold text-omega-900"><span className="hover:text-omega-accent hover:underline">{o.motorista || 'Não identificado'}</span></td>
                    <td className="py-3 pr-3">
                      <div className="font-bold text-omega-900">{o.tag || 'Sem TAG'}</div>
                      <div className="font-mono text-[11px] text-omega-500">{o.tag_placa}</div>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 tabular-nums">
                      <span className="font-semibold text-status-vermelho">{Math.round(o.velocidade)}</span>
                      <span className="mx-1 text-omega-400">/</span>
                      <span className="text-omega-500">{Math.round(o.limite)} km/h</span>
                      <div className="text-[11px] font-semibold text-omega-600">+{o.percentual_excesso?.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%{o.cerca ? ` · ${o.cerca}` : ''}</div>
                    </td>
                    <td className={`whitespace-nowrap py-3 pr-3 text-xs ${o.duracao_total_s !== null && o.duracao_total_s >= 10 ? 'font-bold text-omega-800' : 'text-omega-500'}`}>
                      {formatarDuracao(o.duracao_total_s)}
                    </td>
                    <td className="py-3 pr-3">{o.faixa !== 'NORMAL' ? <SeloFaixa faixa={o.faixa} /> : <span className="text-xs text-omega-400">≤7%</span>}</td>
                    <td className="max-w-[240px] py-3 pr-3 text-xs text-omega-600">
                      {o.ocorrencia_no_mes ? (
                        <>
                          <div className="font-bold text-status-vermelho">{ordinal(o.ocorrencia_no_mes)} {FAIXA_VELOCIDADE[o.faixa]?.label.toLowerCase()} no mês</div>
                          <div className="line-clamp-2" title={o.medida}>{o.medida}</div>
                        </>
                      ) : o.classificacao === 'ABAIXO_GATILHO' ? 'Aguardando validação da Central' : '—'}
                    </td>
                    <td className="py-3 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {o.plano_acao ? (
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${STATUS_PLANO[o.plano_acao.status]?.classe}`}>Plano {STATUS_PLANO[o.plano_acao.status]?.label.toLowerCase()}</span>
                      ) : podeGerenciar && o.faixa !== 'NORMAL' && (o.classificacao === 'ABAIXO_GATILHO' || o.validada_manualmente) ? (
                        <div className="flex justify-end gap-1">
                          {validando === o.chave ? <Loader2 size={14} className="animate-spin" /> : (
                            <>
                              {o.classificacao !== 'CONFIRMADA' && (
                                <button type="button" onClick={() => validar(o, 'CONFIRMADA')} className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-bold text-status-vermelho hover:bg-red-50">
                                  <BadgeCheck size={12} className="mr-0.5 inline" />Confirmar
                                </button>
                              )}
                              {o.classificacao !== 'DESCARTADA' && (
                                <button type="button" onClick={() => validar(o, 'DESCARTADA')} className="rounded-md border border-omega-200 px-2 py-1 text-[11px] font-bold text-omega-600 hover:bg-omega-50">Descartar</button>
                              )}
                              {o.validada_manualmente && (
                                <button type="button" onClick={() => validar(o, 'AUTOMATICA')} className="rounded-md px-2 py-1 text-[11px] text-omega-500 hover:underline">Desfazer</button>
                              )}
                            </>
                          )}
                        </div>
                      ) : podeGerenciar && o.classificacao === 'CONFIRMADA' && o.motorista ? (
                        <button type="button" onClick={() => abrirPlanoNovo([o])} className="rounded-md border border-omega-red-600/40 px-2 py-1 text-[11px] font-bold text-omega-red-600 hover:bg-red-50">+ Plano</button>
                      ) : <span className="text-xs text-omega-400">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!carregando && !visiveis.length && <tr><td colSpan={10} className="py-10 text-center text-omega-500">Nenhuma ocorrência no filtro atual. Selecione outras semanas no topo da tela.</td></tr>}
              {carregando && !visiveis.length && <tr><td colSpan={10} className="py-10 text-center"><Loader2 className="mx-auto animate-spin text-omega-400" /></td></tr>}
            </tbody>
          </table>
        </div>
        {visiveis.length > limiteLista && (
          <div className="text-center">
            <button type="button" className="btn-secondary text-xs" onClick={() => setLimiteLista((l) => l + 100)}>
              Mostrar mais ({visiveis.length - limiteLista} restantes)
            </button>
          </div>
        )}
      </div>

      <div className="card space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-bold text-omega-900"><ClipboardList size={16} className="text-omega-accent" /> Planos de ação — velocidade</h3>
          <button type="button" className="text-xs font-semibold text-omega-accent hover:underline" onClick={() => setMostrarMatriz((m) => !m)}>
            {mostrarMatriz ? 'Ocultar' : 'Ver'} Matriz de Velocidade (Anexo I)
          </button>
        </div>
        {mostrarMatriz && <MatrizVelocidade matriz={matriz} />}
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-omega-50 text-left text-xs font-semibold uppercase tracking-wider text-omega-500">
              <tr>
                <th className="rounded-tl-xl py-3 pl-3 pr-3">Status</th>
                <th className="py-3 pr-3">Condutor</th>
                <th className="py-3 pr-3">Linha da matriz</th>
                <th className="py-3 pr-3">Medida</th>
                <th className="py-3 pr-3">Ações</th>
                <th className="py-3 pr-3">Responsável</th>
                <th className="rounded-tr-xl py-3 pr-3">Prazo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-omega-100">
              {planos.map((p) => {
                const acoes = Array.isArray(p.acoes) ? p.acoes : [];
                return (
                  <tr key={p.id} className="cursor-pointer align-top hover:bg-omega-50" onClick={() => setPlanoCtx({ tipo: 'VELOCIDADE', motorista: p.motorista, tag_placa: p.tag_placa, plano: p })}>
                    <td className="py-3 pl-3 pr-3">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${STATUS_PLANO[p.status]?.classe}`}>{STATUS_PLANO[p.status]?.label}</span>
                      {p.atrasado && <div className="mt-1 text-[11px] font-bold text-status-vermelho">Atrasado</div>}
                    </td>
                    <td className="py-3 pr-3 font-semibold text-omega-900">{p.motorista}<div className="text-[11px] font-normal text-omega-500">{p.total_eventos} linha(s)</div></td>
                    <td className="py-3 pr-3 text-xs text-omega-700">{ROTULO_LINHA_MATRIZ[p.linha_matriz]}<div className="text-omega-500">{ordinal(p.nivel_recorrencia)}</div></td>
                    <td className="max-w-[320px] py-3 pr-3 text-xs text-omega-700">{p.medida_matriz}</td>
                    <td className="py-3 pr-3 text-xs text-omega-600">{acoes.filter((a) => a.concluida).length}/{acoes.length}</td>
                    <td className="py-3 pr-3 text-xs text-omega-600">{p.responsavel || '—'}</td>
                    <td className="whitespace-nowrap py-3 pr-3 text-xs text-omega-600">{formatarData(p.prazo)}</td>
                  </tr>
                );
              })}
              {!planos.length && <tr><td colSpan={7} className="py-8 text-center text-omega-500">Nenhum plano de ação. Selecione excessos confirmados de um condutor e use “Montar plano de ação”.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <PainelCondutor
        motorista={condutor}
        aberto={Boolean(condutor)}
        onFechar={() => setCondutor(null)}
        tipoPrincipal="VELOCIDADE"
        onCriarPlano={abrirPlanoNovo}
        onAbrirPlano={(p) => { setCondutor(null); setPlanoCtx({ tipo: p.tipo, motorista: p.motorista, tag_placa: p.tag_placa, plano: p }); }}
        versao={versao}
        podeGerenciar={podeGerenciar}
      />
      <ModalPlanoAcao
        aberto={Boolean(planoCtx)}
        contexto={planoCtx}
        matriz={matrizPlano}
        onFechar={() => setPlanoCtx(null)}
        onSalvo={() => { setPlanoCtx(null); setSelecionadas([]); recarregar(); }}
      />
    </div>
  );
}
