// Histórico do condutor: todos os eventos dele em outros momentos, ocorrências de
// fadiga com farol, resumo mensal e planos de ação — base para montar um novo plano.
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ClipboardList, Loader2, MapPin, Truck } from 'lucide-react';
import Modal from '../Modal.jsx';
import BadgeStatus from '../BadgeStatus.jsx';
import {
  FAROL_FADIGA,
  ROTULO_LINHA_MATRIZ,
  STATUS_PLANO,
  apiTelemetria,
  formatarData,
  formatarDataHora,
  ordinal,
  rotuloMes,
} from '../../utils/telemetriaApi.js';

export function SeloFarol({ classificacao, manual }) {
  const f = FAROL_FADIGA[classificacao] || FAROL_FADIGA.EM_ANALISE;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${f.classe}`} title={f.descricao}>
      <span className="h-2 w-2 rounded-full" style={{ background: f.cor }} />
      {f.curto}
      {manual && <span className="font-normal opacity-70">(Central)</span>}
    </span>
  );
}

export default function PainelCondutor({ motorista, aberto, onFechar, onCriarPlano, onAbrirPlano, versao, podeGerenciar }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [aba, setAba] = useState('fadiga');

  const carregar = useCallback(async () => {
    if (!motorista) return;
    setCarregando(true);
    setErro(null);
    try {
      setDados(await apiTelemetria(`/motoristas/historico?motorista=${encodeURIComponent(motorista)}`, { erro: 'Falha ao carregar o histórico' }));
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [motorista]);

  useEffect(() => {
    if (aberto) carregar();
  }, [aberto, carregar, versao]);

  useEffect(() => {
    if (aberto) setAba('fadiga');
  }, [aberto, motorista]);

  const confirmadasSemPlano = (dados?.ocorrencias_fadiga || []).filter((o) => o.classificacao === 'CONFIRMADA' && !o.plano_acao_id);

  return (
    <Modal open={aberto} onClose={onFechar} title={motorista || 'Condutor'} subtitle="Histórico de telemetria do condutor em todos os períodos importados." size="xl">
      {carregando && !dados && <div className="py-10 text-center text-omega-500"><Loader2 className="mx-auto animate-spin" /></div>}
      {erro && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-status-vermelho">
          <AlertCircle size={16} /> {erro}
        </div>
      )}
      {dados && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5 text-xs text-omega-600">
              {dados.veiculos.map((v) => (
                <span key={v} className="inline-flex items-center gap-1 rounded-md bg-omega-100 px-2 py-0.5 font-semibold"><Truck size={12} /> {v}</span>
              ))}
              <span className="px-1 py-0.5">{dados.total_eventos} evento(s) no histórico</span>
            </div>
            {podeGerenciar && (
              <button
                type="button"
                className="btn-omega-red text-xs"
                disabled={!confirmadasSemPlano.length}
                title={confirmadasSemPlano.length ? '' : 'Nenhuma fadiga confirmada sem plano de ação'}
                onClick={() => onCriarPlano(confirmadasSemPlano)}
              >
                <ClipboardList size={14} /> Plano de ação ({confirmadasSemPlano.length} confirmada(s) sem plano)
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-omega-50 text-left font-semibold uppercase tracking-wider text-omega-500">
                <tr>
                  <th className="px-2 py-2">Mês</th>
                  <th className="px-2 py-2 text-center">Fadiga confirmada</th>
                  <th className="px-2 py-2 text-center">Em análise</th>
                  <th className="px-2 py-2 text-center">Veículo parado</th>
                  <th className="px-2 py-2 text-center">Sem parada obrig.</th>
                  <th className="px-2 py-2 text-center">Excesso de velocidade</th>
                  <th className="px-2 py-2 text-center">Outros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-omega-100">
                {dados.resumo_mensal.map((m) => (
                  <tr key={m.mes}>
                    <td className="px-2 py-1.5 font-semibold text-omega-800">{rotuloMes(m.mes)}</td>
                    <td className={`px-2 py-1.5 text-center font-bold ${m.fadiga_confirmada >= 3 ? 'text-status-vermelho' : m.fadiga_confirmada ? 'text-orange-600' : 'text-omega-400'}`}>
                      {m.fadiga_confirmada}{m.fadiga_confirmada >= 3 ? ' · Comitê' : ''}
                    </td>
                    <td className="px-2 py-1.5 text-center">{m.fadiga_em_analise}</td>
                    <td className="px-2 py-1.5 text-center text-omega-500">{m.fadiga_veiculo_parado}</td>
                    <td className="px-2 py-1.5 text-center">{m.sem_parada}</td>
                    <td className="px-2 py-1.5 text-center">{m.velocidade}{m.velocidade_grave ? <span className="text-status-vermelho"> ({m.velocidade_grave} graves)</span> : ''}</td>
                    <td className="px-2 py-1.5 text-center">{m.outros}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            {[['fadiga', `Fadiga (${dados.ocorrencias_fadiga.length})`], ['outros', `Outros eventos (${dados.outros_eventos.length})`], ['planos', `Planos (${dados.planos.length})`]].map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAba(id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${aba === id ? 'bg-omega-900 text-white' : 'bg-omega-100 text-omega-700 hover:bg-omega-200'}`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {aba === 'fadiga' && (
            <ol className="relative space-y-2 border-l-2 border-omega-200 pl-4">
              {dados.ocorrencias_fadiga.map((o) => (
                <li key={o.chave} className="relative">
                  <span className="absolute -left-[23px] top-2 h-3 w-3 rounded-full ring-2 ring-white" style={{ background: FAROL_FADIGA[o.classificacao]?.cor }} />
                  <div className="rounded-xl border border-omega-100 p-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-omega-900">{formatarDataHora(o.inicio)}</span>
                      <SeloFarol classificacao={o.classificacao} manual={o.validada_manualmente} />
                      {o.ocorrencia_no_mes && <span className="font-semibold text-status-vermelho">{ordinal(o.ocorrencia_no_mes)} no mês</span>}
                      {o.sem_parada && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Sem parada obrigatória</span>}
                      {o.plano_acao_id && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">Em plano de ação</span>}
                    </div>
                    <div className="mt-1 text-omega-600">
                      {o.deteccoes.length} detecção(ões) · até {Math.round(o.velocidade_max)} km/h · {o.tag || 'Sem TAG'} · {o.tag_placa}
                    </div>
                    {o.localizacao && (
                      <div className="mt-0.5 flex items-start gap-1 text-omega-500">
                        <MapPin size={11} className="mt-0.5 shrink-0" />
                        {o.link_mapa ? <a href={o.link_mapa} target="_blank" rel="noopener noreferrer" className="hover:text-omega-accent">{o.localizacao}</a> : o.localizacao}
                      </div>
                    )}
                    {o.medidas && (
                      <div className="mt-1.5 rounded-lg bg-omega-50 p-2 text-[11px] text-omega-700">
                        <div><strong>Elegível:</strong> {o.medidas.elegivel}</div>
                        <div><strong>Não elegível:</strong> {o.medidas.nao_elegivel}</div>
                        {o.medidas.sem_parada && <div className="text-status-vermelho"><strong>Sem parada:</strong> {o.medidas.sem_parada}</div>}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {!dados.ocorrencias_fadiga.length && <li className="text-xs text-omega-500">Nenhuma fadiga detectada para este condutor.</li>}
            </ol>
          )}

          {aba === 'outros' && (
            <div className="max-h-[360px] overflow-y-auto">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-omega-100">
                  {dados.outros_eventos.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-omega-600">{formatarDataHora(e.data_hora)}</td>
                      <td className="py-1.5 pr-3 font-semibold text-omega-800">{e.evento}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-omega-600">
                        {e.valor != null ? `${Math.round(e.valor)}${e.limite ? ` / ${Math.round(e.limite)}` : ''} km/h` : '—'}
                      </td>
                      <td className="py-1.5 pr-3 text-omega-500">{e.localizacao || '—'}</td>
                      <td className="py-1.5 text-right"><BadgeStatus status={e.severidade} /></td>
                    </tr>
                  ))}
                  {!dados.outros_eventos.length && <tr><td className="py-4 text-center text-omega-500">Nenhum outro evento.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {aba === 'planos' && (
            <ul className="space-y-2">
              {dados.planos.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onAbrirPlano(p)} className="w-full rounded-xl border border-omega-100 p-2.5 text-left text-xs hover:bg-omega-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${STATUS_PLANO[p.status]?.classe}`}>{STATUS_PLANO[p.status]?.label}</span>
                      <span className="font-bold text-omega-900">{ROTULO_LINHA_MATRIZ[p.linha_matriz]} · {ordinal(p.nivel_recorrencia)}</span>
                      <span className="text-omega-500">criado em {formatarData(p.created_at)} · prazo {formatarData(p.prazo)}</span>
                    </div>
                    <div className="mt-1 text-omega-700">{p.medida_matriz}</div>
                  </button>
                </li>
              ))}
              {!dados.planos.length && <li className="text-xs text-omega-500">Nenhum plano de ação para este condutor.</li>}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
