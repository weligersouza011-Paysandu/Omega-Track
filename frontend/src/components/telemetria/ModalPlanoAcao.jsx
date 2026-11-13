// Plano de ação de fadiga (criação a partir de ocorrências selecionadas, ou edição),
// com a medida da Matriz de Avaliação de Condutas — Anexo I do PGS-007245.
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckSquare, Loader2, Plus, RotateCcw, Square, Trash2 } from 'lucide-react';
import Modal from '../Modal.jsx';
import {
  ROTULO_LINHA_MATRIZ,
  STATUS_PLANO,
  apiTelemetria,
  dataMaisDias,
  formatarDataHora,
  ordinal,
} from '../../utils/telemetriaApi.js';

const COLUNAS = ['01 evento', '02 eventos', '03 ou mais'];

function medidaDaMatriz(matriz, linha, nivel, elegivel) {
  const item = matriz?.[linha];
  if (!item) return '';
  const i = Math.min(Math.max(nivel, 1), 3) - 1;
  if (linha === 'FADIGA_VERDADEIRA') return (elegivel === false ? item.nao_elegivel : item.elegivel)[i];
  return item.medidas[i];
}

/** Linha da matriz com a célula do nível atual em destaque. */
function LinhaMatriz({ matriz, linha, nivel, elegivel }) {
  const item = matriz?.[linha];
  if (!item) return null;
  const linhas = linha === 'FADIGA_VERDADEIRA'
    ? [['Elegíveis', item.elegivel, elegivel !== false], ['Não elegíveis', item.nao_elegivel, elegivel === false]]
    : [[null, item.medidas, true]];
  return (
    <div className="overflow-x-auto rounded-xl border border-omega-200">
      <table className="w-full min-w-[560px] text-[11px]">
        <thead className="bg-teal-700 text-white">
          <tr>
            <th className="px-2 py-1.5 text-left font-bold">
              {linha === 'FADIGA_VERDADEIRA' ? 'Empregado' : 'Crítico · N3'}
            </th>
            {COLUNAS.map((c) => <th key={c} className="px-2 py-1.5 text-center font-bold">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {linhas.map(([rotulo, medidas, ativa]) => (
            <tr key={rotulo || 'unica'} className="border-t border-omega-200">
              <td className="px-2 py-1.5 font-semibold text-omega-700">{rotulo || item.titulo}</td>
              {medidas.map((m, i) => {
                const destaque = ativa && i === Math.min(nivel, 3) - 1;
                return (
                  <td
                    key={i}
                    className={`px-2 py-1.5 text-center align-top leading-snug ${
                      destaque ? 'bg-red-100 font-bold text-red-800 ring-2 ring-inset ring-red-500' : m?.includes('Comitê') ? 'bg-red-50 text-omega-700' : 'bg-green-50 text-omega-700'
                    }`}
                  >
                    {m}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ModalPlanoAcao({ aberto, onFechar, onSalvo, matriz, contexto }) {
  const plano = contexto?.plano || null;
  const ocorrencias = contexto?.ocorrencias || [];
  const edicao = Boolean(plano);

  // Recorrência no mês conforme a linha: fadiga confirmada conta as ocorrências de fadiga;
  // "sem parada" conta só as paradas obrigatórias não cumpridas; Prontidão não vem da telemetria.
  const nivelPara = useMemo(() => (linha) => {
    const campo = linha === 'SEM_PARADA' ? 'sem_parada_no_mes' : linha === 'FADIGA_VERDADEIRA' ? 'ocorrencia_no_mes' : null;
    if (!campo) return 1;
    return Math.min(Math.max(...ocorrencias.map((o) => o[campo] || 0), 1), 3);
  }, [ocorrencias]);
  const linhaSugerida = ocorrencias.some((o) => o.sem_parada) ? 'SEM_PARADA' : 'FADIGA_VERDADEIRA';
  const nivelSugerido = nivelPara(linhaSugerida);

  const [form, setForm] = useState(null);
  const [medidaEditada, setMedidaEditada] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setMedidaEditada(edicao);
    setForm(plano ? {
      linha_matriz: plano.linha_matriz,
      nivel_recorrencia: plano.nivel_recorrencia,
      elegivel_prontidao: plano.elegivel_prontidao,
      medida_matriz: plano.medida_matriz,
      analise: plano.analise || '',
      acoes: Array.isArray(plano.acoes) ? plano.acoes : [],
      responsavel: plano.responsavel || '',
      prazo: plano.prazo ? String(plano.prazo).slice(0, 10) : '',
      status: plano.status,
      conclusao: plano.conclusao || '',
    } : {
      linha_matriz: linhaSugerida,
      nivel_recorrencia: nivelSugerido,
      elegivel_prontidao: true,
      medida_matriz: '',
      analise: '',
      acoes: [{ descricao: '', responsavel: '', prazo: dataMaisDias(15), concluida: false }],
      responsavel: '',
      prazo: dataMaisDias(15),
      status: 'ABERTO',
      conclusao: '',
    });
  }, [aberto, plano, edicao, linhaSugerida, nivelSugerido]);

  // Medida automática da matriz enquanto o analista não a editar à mão.
  useEffect(() => {
    if (!form || medidaEditada || !matriz) return;
    const medida = medidaDaMatriz(matriz, form.linha_matriz, form.nivel_recorrencia, form.elegivel_prontidao);
    if (medida !== form.medida_matriz) setForm((f) => ({ ...f, medida_matriz: medida }));
  }, [form, medidaEditada, matriz]);

  if (!aberto || !form) return null;
  const atualizar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const atualizarAcao = (i, campo, valor) => setForm((f) => ({ ...f, acoes: f.acoes.map((a, j) => (j === i ? { ...a, [campo]: valor } : a)) }));

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const corpo = {
        medida_matriz: form.medida_matriz,
        analise: form.analise,
        acoes: form.acoes,
        responsavel: form.responsavel,
        prazo: form.prazo || null,
      };
      if (edicao) {
        await apiTelemetria(`/planos/${plano.id}`, {
          metodo: 'PATCH', corpo: { ...corpo, status: form.status, conclusao: form.conclusao }, erro: 'Falha ao salvar o plano',
        });
      } else {
        await apiTelemetria('/planos', {
          metodo: 'POST',
          erro: 'Falha ao criar o plano',
          corpo: {
            ...corpo,
            motorista: contexto.motorista,
            tag_placa: contexto.tag_placa,
            linha_matriz: form.linha_matriz,
            nivel_recorrencia: form.nivel_recorrencia,
            elegivel_prontidao: form.linha_matriz === 'FADIGA_VERDADEIRA' ? form.elegivel_prontidao : null,
            eventos_ids: ocorrencias.flatMap((o) => o.ids),
          },
        });
      }
      onSalvo();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      open={aberto}
      onClose={() => !salvando && onFechar()}
      title={edicao ? 'Plano de Ação — Fadiga' : 'Novo Plano de Ação — Fadiga'}
      subtitle={`${contexto.motorista}${contexto.tag_placa ? ` · ${contexto.tag_placa}` : ''} — medida conforme a Matriz de Avaliação de Condutas (Anexo I, PGS-007245).`}
      size="lg"
    >
      <div className="space-y-4">
        {erro && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-status-vermelho">
            <AlertCircle size={16} className="shrink-0" /> {erro}
          </div>
        )}

        {!edicao && ocorrencias.length > 0 && (
          <div className="rounded-xl border border-omega-200 bg-omega-50 p-3 text-xs text-omega-700">
            <div className="mb-1 font-bold text-omega-900">Conjunto de dados analisado ({ocorrencias.length} ocorrência(s))</div>
            <ul className="space-y-0.5">
              {ocorrencias.map((o) => (
                <li key={o.chave}>
                  {formatarDataHora(o.inicio)} · {o.deteccoes.length} detecção(ões) · até {Math.round(o.velocidade_max)} km/h
                  {o.ocorrencia_no_mes ? ` · ${ordinal(o.ocorrencia_no_mes)} no mês` : ''}
                  {o.sem_parada ? ' · sem parada obrigatória' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <span className="label">Linha da matriz</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(ROTULO_LINHA_MATRIZ).map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                disabled={edicao}
                onClick={() => { setForm((f) => ({ ...f, linha_matriz: id, nivel_recorrencia: nivelPara(id) })); setMedidaEditada(false); }}
                className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                  form.linha_matriz === id ? 'border-omega-900 bg-omega-900 text-white' : 'border-omega-200 text-omega-700 hover:bg-omega-50'
                } disabled:cursor-not-allowed`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="label">Ocorrência no mês</span>
            <select
              className="input"
              disabled={edicao}
              value={form.nivel_recorrencia}
              onChange={(e) => { atualizar('nivel_recorrencia', Number(e.target.value)); setMedidaEditada(false); }}
            >
              <option value={1}>1º evento</option>
              <option value={2}>2º evento</option>
              <option value={3}>3º ou mais eventos</option>
            </select>
          </div>
          {form.linha_matriz === 'FADIGA_VERDADEIRA' && (
            <div>
              <span className="label">Elegível ao teste de Prontidão (Anexo IV do PNR-000257)?</span>
              <select
                className="input"
                disabled={edicao}
                value={form.elegivel_prontidao === false ? 'nao' : 'sim'}
                onChange={(e) => { atualizar('elegivel_prontidao', e.target.value === 'sim'); setMedidaEditada(false); }}
              >
                <option value="sim">Sim — elegível</option>
                <option value="nao">Não elegível</option>
              </select>
            </div>
          )}
        </div>

        <LinhaMatriz matriz={matriz} linha={form.linha_matriz} nivel={form.nivel_recorrencia} elegivel={form.elegivel_prontidao} />

        <div>
          <div className="flex items-center justify-between">
            <span className="label">Medida a aplicar</span>
            {medidaEditada && !edicao && (
              <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-omega-accent" onClick={() => setMedidaEditada(false)}>
                <RotateCcw size={12} /> Voltar à medida da matriz
              </button>
            )}
          </div>
          <textarea
            className="input min-h-[60px]"
            value={form.medida_matriz}
            onChange={(e) => { atualizar('medida_matriz', e.target.value); setMedidaEditada(true); }}
          />
          <p className="mt-1 text-[11px] text-omega-500">
            Fica a critério do líder e/ou da medicina afastar o empregado das atividades de risco caso seja necessário.
          </p>
        </div>

        <div>
          <span className="label">Análise do conjunto de eventos</span>
          <textarea
            className="input min-h-[70px]"
            placeholder="Ex.: fadigas no fim do turno, após jornada estendida; condutor relata noite mal dormida..."
            value={form.analise}
            onChange={(e) => atualizar('analise', e.target.value)}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label mb-0">Ações</span>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-semibold text-omega-accent"
              onClick={() => atualizar('acoes', [...form.acoes, { descricao: '', responsavel: '', prazo: form.prazo, concluida: false }])}
            >
              <Plus size={14} /> Adicionar ação
            </button>
          </div>
          <div className="space-y-2">
            {form.acoes.map((a, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-omega-200 p-2 sm:grid-cols-[auto_1fr_160px_140px_auto] sm:items-center">
                <button type="button" title="Concluída" onClick={() => atualizarAcao(i, 'concluida', !a.concluida)} className="text-omega-600">
                  {a.concluida ? <CheckSquare size={18} className="text-status-verde" /> : <Square size={18} />}
                </button>
                <input className="input" placeholder="Descrição da ação" value={a.descricao} onChange={(e) => atualizarAcao(i, 'descricao', e.target.value)} />
                <input className="input" placeholder="Responsável" value={a.responsavel || ''} onChange={(e) => atualizarAcao(i, 'responsavel', e.target.value)} />
                <input className="input" type="date" value={a.prazo || ''} onChange={(e) => atualizarAcao(i, 'prazo', e.target.value)} />
                <button type="button" title="Remover" onClick={() => atualizar('acoes', form.acoes.filter((_, j) => j !== i))} className="text-omega-400 hover:text-status-vermelho">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {!form.acoes.length && <p className="text-xs text-omega-500">Nenhuma ação cadastrada.</p>}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <span className="label">Responsável pelo plano</span>
            <input className="input" value={form.responsavel} onChange={(e) => atualizar('responsavel', e.target.value)} placeholder="Líder / gestor" />
          </div>
          <div>
            <span className="label">Prazo (padrão 15 dias)</span>
            <input className="input" type="date" value={form.prazo} onChange={(e) => atualizar('prazo', e.target.value)} />
          </div>
          {edicao && (
            <div>
              <span className="label">Status</span>
              <select className="input" value={form.status} onChange={(e) => atualizar('status', e.target.value)}>
                {Object.entries(STATUS_PLANO).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
              </select>
            </div>
          )}
        </div>

        {edicao && (
          <div>
            <span className="label">Conclusão / evidências {form.status === 'CONCLUIDO' && <span className="text-status-vermelho">*</span>}</span>
            <textarea
              className="input min-h-[60px]"
              placeholder="Obrigatória para concluir: o que foi aplicado, quando e por quem."
              value={form.conclusao}
              onChange={(e) => atualizar('conclusao', e.target.value)}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-omega-100 pt-3">
          <button type="button" className="btn-secondary" onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={salvar} disabled={salvando || !form.medida_matriz?.trim()}>
            {salvando && <Loader2 size={14} className="animate-spin" />}
            {edicao ? 'Salvar plano' : 'Criar plano de ação'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
