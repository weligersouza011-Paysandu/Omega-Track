// Aba "Fadiga Detectada": farol de consistência (veículo parado / em análise /
// confirmada), mapa, ocorrências, validação da Central, histórico do condutor e
// planos de ação com a matriz de "Eventos de Fadiga" do Anexo I (PGS-007245).
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Ban,
  ClipboardList,
  Info,
  Loader2,
  MapPin,
  Moon,
  OctagonAlert,
  ParkingCircle,
  ShieldAlert,
  Users,
} from 'lucide-react';
import StatCard from '../StatCard.jsx';
import MapaFadiga from './MapaOcorrencias.jsx';
import ModalPlanoAcao from './ModalPlanoAcao.jsx';
import PainelCondutor, { SeloFarol } from './PainelCondutor.jsx';
import {
  FAROL_FADIGA,
  ROTULO_LINHA_MATRIZ,
  STATUS_PLANO,
  apiTelemetria,
  formatarData,
  formatarDataHora,
  formatarHora,
  ordinal,
} from '../../utils/telemetriaApi.js';

const FILTROS_FAROL = [
  { id: '', label: 'Todas' },
  { id: 'CONFIRMADA', label: 'Confirmadas' },
  { id: 'EM_ANALISE', label: 'Em análise' },
  { id: 'VEICULO_PARADO', label: 'Veículo parado' },
  { id: 'DESCARTADA', label: 'Descartadas' },
];

function MatrizAnexo({ matriz }) {
  if (!matriz) return null;
  const { FADIGA_VERDADEIRA: fv, PRONTIDAO: pr, SEM_PARADA: sp } = matriz;
  const celula = (texto) => (
    <td className={`border border-omega-200 px-2 py-1.5 text-center align-middle ${texto?.includes('Comitê') ? 'bg-red-100 text-red-800' : 'bg-green-50 text-omega-700'}`}>{texto}</td>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-[11px]">
        <thead className="bg-teal-700 text-white">
          <tr>
            {['Tipo de evento', 'Potencial severidade', 'Classificação', '01 evento', '02 eventos', '03 ou mais eventos'].map((t) => (
              <th key={t} className="border border-teal-800 px-2 py-1.5 font-bold">{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td rowSpan={2} className="border border-omega-200 bg-green-50 px-2 py-1.5 font-semibold text-omega-800">{fv.titulo}<div className="font-normal text-omega-500">Empregados elegíveis / não elegíveis ao Prontidão</div></td>
            <td rowSpan={2} className="border border-omega-200 bg-green-50 px-2 text-center">Crítico</td>
            <td rowSpan={2} className="border border-omega-200 bg-green-50 px-2 text-center">N3</td>
            {celula(`Elegíveis: ${fv.elegivel[0]}`)}
            <td colSpan={2} className="border border-omega-200 bg-green-50 px-2 py-1.5 text-center text-omega-700">Elegíveis: {fv.elegivel[1]}</td>
          </tr>
          <tr>
            {celula(`Não elegíveis: ${fv.nao_elegivel[0]}`)}
            <td colSpan={2} className="border border-omega-200 bg-green-50 px-2 py-1.5 text-center text-omega-700">Não elegíveis: {fv.nao_elegivel[1]}</td>
          </tr>
          {[pr, sp].map((linha) => (
            <tr key={linha.titulo}>
              <td className="border border-omega-200 bg-green-50 px-2 py-1.5 font-semibold text-omega-800">{linha.titulo}</td>
              <td className="border border-omega-200 bg-green-50 px-2 text-center">Crítico</td>
              <td className="border border-omega-200 bg-green-50 px-2 text-center">N3</td>
              {linha.medidas.map((m) => <td key={m} className={`border border-omega-200 px-2 py-1.5 text-center ${m.includes('Comitê') ? 'bg-red-100 text-red-800' : 'bg-green-50 text-omega-700'}`}>{m}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FadigaDetectadaTab({ horas, busca, podeGerenciar }) {
  const [dados, setDados] = useState(null);
  const [planos, setPlanos] = useState([]);
  const [matriz, setMatriz] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [farol, setFarol] = useState('');
  const [selecionadas, setSelecionadas] = useState([]);
  const [versao, setVersao] = useState(0);
  const [condutor, setCondutor] = useState(null);
  const [planoCtx, setPlanoCtx] = useState(null);
  const [validando, setValidando] = useState(null);
  const [mostrarMatriz, setMostrarMatriz] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (horas) params.set('horas', String(horas));
      if (busca) params.set('busca', busca);
      const [analise, listaPlanos] = await Promise.all([
        apiTelemetria(`/fadiga?${params}`, { erro: 'Falha ao carregar a analise de fadiga' }),
        apiTelemetria('/planos?tipo=FADIGA', { erro: 'Falha ao carregar os planos de acao' }),
      ]);
      setDados(analise);
      setPlanos(listaPlanos.planos || []);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [horas, busca]);

  useEffect(() => { carregar(); }, [carregar, versao]);
  useEffect(() => { setSelecionadas([]); }, [horas, busca, farol]);
  useEffect(() => {
    apiTelemetria('/matriz-fadiga').then((r) => setMatriz(r.matriz)).catch(() => {});
  }, []);

  const recarregar = () => setVersao((v) => v + 1);
  const ocorrencias = dados?.ocorrencias || [];
  const visiveis = useMemo(() => (farol ? ocorrencias.filter((o) => o.classificacao === farol) : ocorrencias), [ocorrencias, farol]);
  const porClasse = dados?.kpis?.por_classificacao || {};
  const escolhidas = ocorrencias.filter((o) => selecionadas.includes(o.chave));
  const condutoresEscolhidos = [...new Set(escolhidas.map((o) => o.motorista))];

  function alternar(chave) {
    setSelecionadas((s) => (s.includes(chave) ? s.filter((c) => c !== chave) : [...s, chave]));
  }

  async function validar(o, decisao) {
    let motivo;
    if (decisao === 'DESCARTADA') {
      motivo = window.prompt('Motivo do descarte (ex.: falso positivo no vídeo, uso como benefício comprovado):');
      if (!motivo) return;
    }
    setValidando(o.chave);
    try {
      await apiTelemetria('/fadiga/validacao', { metodo: 'PATCH', corpo: { ids: o.ids, decisao, motivo }, erro: 'Falha ao validar' });
      recarregar();
    } catch (e) {
      alert(e.message);
    } finally {
      setValidando(null);
    }
  }

  function abrirPlanoNovo(lista) {
    const motorista = lista[0]?.motorista;
    if (!motorista) return;
    setCondutor(null);
    setPlanoCtx({ motorista, tag_placa: lista[0].tag_placa, ocorrencias: lista });
  }

  const k = dados?.kpis;

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
            Só <strong>“Sensor de fadiga: Fadiga detectada”</strong> é fadiga real. Cada detecção recebe um farol de consistência
            antes de entrar na Matriz de Avaliação de Condutas:
          </p>
        </div>
        <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {['CONFIRMADA', 'EM_ANALISE', 'VEICULO_PARADO', 'DESCARTADA'].map((c) => (
            <div key={c} className="rounded-xl border border-omega-100 p-2 text-[11px] leading-snug text-omega-600">
              <SeloFarol classificacao={c} />
              <p className="mt-1">{FAROL_FADIGA[c].descricao}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1700px]:grid-cols-6">
        <StatCard title="Detecções" value={k?.deteccoes ?? 0} icon={Moon} iconBg="bg-omega-900" sub={`${k?.ocorrencias ?? 0} ocorrência(s)`} />
        <StatCard title="Fadiga confirmada" value={porClasse.CONFIRMADA ?? 0} icon={OctagonAlert} iconBg="bg-status-vermelho" sub="Crítico · N3" />
        <StatCard title="Em análise" value={porClasse.EM_ANALISE ?? 0} icon={ShieldAlert} iconBg="bg-status-amarelo" sub="Validar pelo vídeo" />
        <StatCard title="Veículo parado" value={porClasse.VEICULO_PARADO ?? 0} icon={ParkingCircle} iconBg="bg-omega-500" sub="Fora da matriz" />
        <StatCard title="Sem parada obrigatória" value={k?.sem_parada_obrigatoria ?? 0} icon={Ban} iconBg="bg-omega-red-600" sub="Após fadiga confirmada" />
        <StatCard title="Confirmadas sem plano" value={k?.confirmadas_sem_plano ?? 0} icon={ClipboardList} iconBg="bg-omega-accent" sub={`${k?.condutores_com_fadiga_confirmada ?? 0} condutor(es)`} />
      </div>

      <div className="grid grid-cols-1 gap-6 min-[1500px]:grid-cols-3">
        <div className="card p-4 min-[1500px]:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <MapPin size={16} className="text-omega-accent" />
            <h3 className="font-bold text-omega-900">Mapa das ocorrências</h3>
            {carregando && <Loader2 size={14} className="animate-spin text-omega-400" />}
          </div>
          <MapaFadiga ocorrencias={visiveis} onSelecionar={(o) => setCondutor(o.motorista)} />
        </div>
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Users size={16} className="text-status-vermelho" />
            <h3 className="font-bold text-omega-900">Condutores com fadiga confirmada</h3>
          </div>
          <ul className="space-y-2">
            {(dados?.ranking_condutores || []).map((r) => (
              <li key={r.motorista || r.placa}>
                <button type="button" onClick={() => r.motorista && setCondutor(r.motorista)} className="w-full rounded-xl border border-omega-100 p-2.5 text-left hover:bg-omega-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-omega-900">{r.motorista || 'Não identificado'}</span>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-extrabold text-white ${r.confirmadas >= 3 ? 'bg-status-vermelho' : 'bg-orange-500'}`}>{r.confirmadas}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-omega-500">
                    {r.tag || 'Sem TAG'} · {r.placa}
                    {r.sem_parada ? <span className="text-status-vermelho"> · {r.sem_parada} sem parada</span> : ''}
                    {r.sem_plano ? <span className="text-omega-accent"> · {r.sem_plano} sem plano</span> : ''}
                  </div>
                </button>
              </li>
            ))}
            {!dados?.ranking_condutores?.length && (
              <li className="rounded-xl border border-dashed border-omega-200 p-4 text-center text-sm text-omega-500">Nenhuma fadiga confirmada no período.</li>
            )}
          </ul>
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <h3 className="font-bold text-omega-900">Ocorrências de fadiga detectada</h3>
          <div className="flex flex-wrap gap-2">
            {FILTROS_FAROL.map((f) => (
              <button
                key={f.id || 'todas'}
                type="button"
                onClick={() => setFarol(f.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${farol === f.id ? 'bg-omega-900 text-white' : 'bg-omega-100 text-omega-700 hover:bg-omega-200'}`}
              >
                {f.label}{f.id ? ` (${porClasse[f.id] ?? 0})` : ''}
              </button>
            ))}
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
              <button
                type="button"
                className="btn-omega-red px-3 py-1.5 text-xs"
                disabled={condutoresEscolhidos.length !== 1 || !condutoresEscolhidos[0]}
                onClick={() => abrirPlanoNovo(escolhidas)}
              >
                <ClipboardList size={14} /> Montar plano de ação
              </button>
            </div>
          </div>
        )}

        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-omega-50 text-left text-xs font-semibold uppercase tracking-wider text-omega-500">
              <tr>
                {podeGerenciar && <th className="w-8 rounded-tl-xl py-3 pl-3" />}
                <th className={`py-3 pr-3 ${podeGerenciar ? '' : 'rounded-tl-xl pl-3'}`}>Farol</th>
                <th className="py-3 pr-3">Data / hora</th>
                <th className="py-3 pr-3">Condutor</th>
                <th className="py-3 pr-3">TAG x Placa</th>
                <th className="py-3 pr-3">Velocidade</th>
                <th className="py-3 pr-3">Parada obrig.</th>
                <th className="py-3 pr-3">Recorrência / medida</th>
                <th className="rounded-tr-xl py-3 pr-3 text-right">Plano / validação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-omega-100">
              {visiveis.map((o) => {
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
                          title={selecionavel ? '' : 'Só fadiga confirmada, de condutor identificado e sem plano, entra em plano de ação'}
                          checked={selecionadas.includes(o.chave)}
                          onChange={() => alternar(o.chave)}
                        />
                      </td>
                    )}
                    <td className={`py-3 pr-3 ${podeGerenciar ? '' : 'pl-3'}`}><SeloFarol classificacao={o.classificacao} manual={o.validada_manualmente} /></td>
                    <td className="whitespace-nowrap py-3 pr-3 tabular-nums text-omega-700">
                      {formatarDataHora(o.inicio)}
                      {o.deteccoes.length > 1 && <div className="text-[11px] text-omega-500">{o.deteccoes.length} detecções até {formatarHora(o.fim)}</div>}
                    </td>
                    <td className="max-w-[200px] py-3 pr-3 font-semibold text-omega-900">
                      <span className="hover:text-omega-accent hover:underline">{o.motorista || 'Não identificado'}</span>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-bold text-omega-900">{o.tag || 'Sem TAG'}</div>
                      <div className="font-mono text-[11px] text-omega-500">{o.tag_placa}</div>
                    </td>
                    <td className={`whitespace-nowrap py-3 pr-3 tabular-nums font-semibold ${o.em_movimento ? 'text-status-vermelho' : 'text-omega-400'}`}>
                      {Math.round(o.velocidade_max)} km/h
                    </td>
                    <td className="py-3 pr-3 text-xs">
                      {!o.em_movimento ? <span className="text-omega-400">—</span>
                        : o.sem_parada ? <span className="font-bold text-status-vermelho">Não cumprida</span>
                          : o.deteccoes.some((d) => d.parou_em_15_min === true) ? <span className="text-status-verde">Cumprida</span>
                            : <span className="text-omega-500">Sem dados</span>}
                    </td>
                    <td className="max-w-[260px] py-3 pr-3 text-xs text-omega-600">
                      {o.ocorrencia_no_mes ? (
                        <>
                          <div className="font-bold text-status-vermelho">{ordinal(o.ocorrencia_no_mes)} no mês</div>
                          <div className="line-clamp-2" title={`Elegível: ${o.medidas.elegivel}\nNão elegível: ${o.medidas.nao_elegivel}`}>{o.medidas.elegivel}</div>
                        </>
                      ) : o.classificacao === 'EM_ANALISE' ? 'Aguardando validação da Central' : '—'}
                    </td>
                    <td className="py-3 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {o.plano_acao ? (
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${STATUS_PLANO[o.plano_acao.status]?.classe}`}>
                          Plano {STATUS_PLANO[o.plano_acao.status]?.label.toLowerCase()}
                        </span>
                      ) : podeGerenciar && (o.classificacao === 'EM_ANALISE' || o.validada_manualmente) ? (
                        <div className="flex justify-end gap-1">
                          {validando === o.chave ? <Loader2 size={14} className="animate-spin" /> : (
                            <>
                              {o.classificacao !== 'CONFIRMADA' && (
                                <button type="button" title="Confirmar fadiga" onClick={() => validar(o, 'CONFIRMADA')} className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-bold text-status-vermelho hover:bg-red-50">
                                  <BadgeCheck size={12} className="mr-0.5 inline" />Confirmar
                                </button>
                              )}
                              {o.classificacao !== 'DESCARTADA' && (
                                <button type="button" title="Descartar" onClick={() => validar(o, 'DESCARTADA')} className="rounded-md border border-omega-200 px-2 py-1 text-[11px] font-bold text-omega-600 hover:bg-omega-50">
                                  Descartar
                                </button>
                              )}
                              {o.validada_manualmente && (
                                <button type="button" title="Voltar ao farol automático" onClick={() => validar(o, 'AUTOMATICA')} className="rounded-md px-2 py-1 text-[11px] text-omega-500 hover:underline">
                                  Desfazer
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      ) : podeGerenciar && o.classificacao === 'CONFIRMADA' && o.motorista ? (
                        <button type="button" onClick={() => abrirPlanoNovo([o])} className="rounded-md border border-omega-red-600/40 px-2 py-1 text-[11px] font-bold text-omega-red-600 hover:bg-red-50">
                          + Plano
                        </button>
                      ) : <span className="text-xs text-omega-400">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!carregando && !visiveis.length && (
                <tr><td colSpan={9} className="py-10 text-center text-omega-500">Nenhuma fadiga detectada no filtro atual. Amplie o período no topo da tela.</td></tr>
              )}
              {carregando && !visiveis.length && (
                <tr><td colSpan={9} className="py-10 text-center"><Loader2 className="mx-auto animate-spin text-omega-400" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-bold text-omega-900"><ClipboardList size={16} className="text-omega-accent" /> Planos de ação — fadiga</h3>
          <button type="button" className="text-xs font-semibold text-omega-accent hover:underline" onClick={() => setMostrarMatriz((m) => !m)}>
            {mostrarMatriz ? 'Ocultar' : 'Ver'} Matriz de Avaliação de Condutas (Anexo I)
          </button>
        </div>
        {mostrarMatriz && <MatrizAnexo matriz={matriz} />}
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
                  <tr key={p.id} className="cursor-pointer align-top hover:bg-omega-50" onClick={() => setPlanoCtx({ motorista: p.motorista, tag_placa: p.tag_placa, plano: p })}>
                    <td className="py-3 pl-3 pr-3">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${STATUS_PLANO[p.status]?.classe}`}>{STATUS_PLANO[p.status]?.label}</span>
                      {p.atrasado && <div className="mt-1 text-[11px] font-bold text-status-vermelho">Atrasado</div>}
                    </td>
                    <td className="py-3 pr-3 font-semibold text-omega-900">{p.motorista}<div className="text-[11px] font-normal text-omega-500">{p.total_eventos} evento(s)</div></td>
                    <td className="py-3 pr-3 text-xs text-omega-700">{ROTULO_LINHA_MATRIZ[p.linha_matriz]}<div className="text-omega-500">{ordinal(p.nivel_recorrencia)}{p.elegivel_prontidao === false ? ' · não elegível' : p.elegivel_prontidao ? ' · elegível' : ''}</div></td>
                    <td className="max-w-[320px] py-3 pr-3 text-xs text-omega-700">{p.medida_matriz}</td>
                    <td className="py-3 pr-3 text-xs text-omega-600">{acoes.filter((a) => a.concluida).length}/{acoes.length}</td>
                    <td className="py-3 pr-3 text-xs text-omega-600">{p.responsavel || '—'}</td>
                    <td className="whitespace-nowrap py-3 pr-3 text-xs text-omega-600">{formatarData(p.prazo)}</td>
                  </tr>
                );
              })}
              {!planos.length && (
                <tr><td colSpan={7} className="py-8 text-center text-omega-500">Nenhum plano de ação. Selecione ocorrências confirmadas de um condutor e use “Montar plano de ação”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PainelCondutor
        motorista={condutor}
        aberto={Boolean(condutor)}
        onFechar={() => setCondutor(null)}
        onCriarPlano={abrirPlanoNovo}
        onAbrirPlano={(p) => { setCondutor(null); setPlanoCtx({ motorista: p.motorista, tag_placa: p.tag_placa, plano: p }); }}
        versao={versao}
        podeGerenciar={podeGerenciar}
      />
      <ModalPlanoAcao
        aberto={Boolean(planoCtx)}
        contexto={planoCtx}
        matriz={matriz}
        onFechar={() => setPlanoCtx(null)}
        onSalvo={() => { setPlanoCtx(null); setSelecionadas([]); recarregar(); }}
      />
    </div>
  );
}
