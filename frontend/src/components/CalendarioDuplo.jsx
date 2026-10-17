import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { diaSemanaISO, formatarDataSemTimezone as formatarData, hojeISO, somarDiasISO } from '../utils/datas.js';

// ============================================================================
// Calendário duplo (mês anterior + mês atual lado a lado) para seleção das
// datas da auditoria de pendências. Modos de seleção:
//  - clique: alterna um dia avulso (acumula vários);
//  - clique e arraste: seleciona um intervalo contínuo (seg–sáb).
// Domingos (não úteis) e datas futuras ficam desabilitados. Dias já auditados
// na consulta atual ganham marcador: âmbar = com pendências (com contagem),
// verde = sem pendências.
//
// Props:
//  - selecionadas: Set<string> de datas ISO selecionadas (controlado);
//  - onChange(Set): notifica nova seleção;
//  - contagens: Map<string, number> data ISO -> pendências (0 = auditado em dia);
//  - onAviso(msg): feedback (ex.: teto de datas da auditoria atingido);
//  - maximo: teto de datas por consulta (backend: 31).
// ============================================================================

const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function nomeMes(ano, mes) {
  return `${MESES[mes]} ${ano}`;
}

// Células de um mês em grade fixa de 6 semanas (42 posições), domingo na
// primeira coluna; posições de preenchimento = null.
function celulasDoMes(ano, mes) {
  const offset = new Date(Date.UTC(ano, mes, 1)).getUTCDay();
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const celulas = Array(offset).fill(null);
  for (let dia = 1; dia <= ultimoDia; dia += 1) {
    celulas.push(`${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`);
  }
  while (celulas.length < 42) celulas.push(null);
  return celulas;
}

// Datas do intervalo inclusivo, pulando domingos (dias não úteis).
function intervaloUtil(inicio, fim) {
  const datas = [];
  for (let d = inicio; d <= fim; d = somarDiasISO(d, 1)) {
    if (diaSemanaISO(d) !== 0) datas.push(d);
  }
  return datas;
}

export default function CalendarioDuplo({
  selecionadas,
  onChange,
  contagens,
  onAviso,
  maximo = 31,
}) {
  const hoje = hojeISO();
  // Mês esquerdo padrão: mês anterior ao atual (direito = mês atual).
  const [mesRef, setMesRef] = useState(() => {
    const [ano, mes] = hoje.split('-').map(Number);
    const anterior = new Date(Date.UTC(ano, mes - 2, 1));
    return { ano: anterior.getUTCFullYear(), mes: anterior.getUTCMonth() };
  });
  // Seleção por arraste em andamento: { ancora, atual } (datas ISO).
  const [arrasto, setArrasto] = useState(null);

  const selecionadasSet = selecionadas instanceof Set ? selecionadas : new Set(selecionadas || []);
  const contagensMap = contagens instanceof Map ? contagens : new Map();

  const meses = useMemo(() => {
    const seguinte = new Date(Date.UTC(mesRef.ano, mesRef.mes + 1, 1));
    return [
      { ano: mesRef.ano, mes: mesRef.mes },
      { ano: seguinte.getUTCFullYear(), mes: seguinte.getUTCMonth() },
    ];
  }, [mesRef]);

  const faixaPreview = useMemo(() => {
    if (!arrasto || arrasto.ancora === arrasto.atual) return null;
    return {
      ini: arrasto.ancora < arrasto.atual ? arrasto.ancora : arrasto.atual,
      fim: arrasto.atual < arrasto.ancora ? arrasto.ancora : arrasto.atual,
    };
  }, [arrasto]);

  const bloqueado = (iso) => diaSemanaISO(iso) === 0 || iso > hoje;

  // Navegação sincronizada: recua/avança os DOIS meses juntos.
  const mover = (delta) => {
    setMesRef((atual) => {
      const d = new Date(Date.UTC(atual.ano, atual.mes + delta, 1));
      return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() };
    });
  };

  // Aplica clique (alterna o dia) ou arraste (adiciona o intervalo contínuo),
  // respeitando o teto de datas por auditoria (mesmo limite do backend).
  const aplicar = (alvo) => {
    const novo = new Set(selecionadasSet);
    if (alvo.ancora === alvo.atual) {
      if (novo.has(alvo.ancora)) {
        novo.delete(alvo.ancora);
      } else if (novo.size >= maximo) {
        onAviso?.(`Limite de ${maximo} datas por auditoria.`);
        return;
      } else {
        novo.add(alvo.ancora);
      }
    } else {
      const ini = alvo.ancora < alvo.atual ? alvo.ancora : alvo.atual;
      const fim = alvo.atual < alvo.ancora ? alvo.ancora : alvo.atual;
      for (const d of intervaloUtil(ini, fim)) {
        if (novo.has(d)) continue;
        if (novo.size >= maximo) {
          onAviso?.(`Limite de ${maximo} datas por auditoria — datas excedentes ignoradas.`);
          break;
        }
        novo.add(d);
      }
    }
    if (novo.size !== selecionadasSet.size) onChange?.(novo);
  };

  // Fecha a seleção por arraste ao soltar o mouse em qualquer lugar da tela.
  useEffect(() => {
    if (!arrasto) return undefined;
    const soltar = () => {
      aplicar(arrasto);
      setArrasto(null);
    };
    window.addEventListener('mouseup', soltar);
    return () => window.removeEventListener('mouseup', soltar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrasto, selecionadas, maximo]);

  return (
    <div>
      {/* Barra de navegação: < recua e > avança os dois meses simultaneamente */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <button
          type="button"
          onClick={() => mover(-1)}
          aria-label="Meses anteriores"
          title="Recuar os dois meses"
          className="p-1.5 rounded-lg border border-omega-200 text-omega-600 hover:bg-omega-50 hover:text-omega-900 transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="hidden sm:inline text-[11px] font-semibold text-omega-400">
          Clique para dias avulsos • arraste para um intervalo contínuo
        </span>
        <button
          type="button"
          onClick={() => mover(1)}
          aria-label="Próximos meses"
          title="Avançar os dois meses"
          className="p-1.5 rounded-lg border border-omega-200 text-omega-600 hover:bg-omega-50 hover:text-omega-900 transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="flex gap-6 min-w-[520px] justify-center">
          {meses.map((m) => (
            <div key={`${m.ano}-${m.mes}`} className="flex-1 max-w-[340px] min-w-[248px]">
              <div className="text-center text-xs md:text-sm font-bold text-omega-900 mb-1.5">
                {nomeMes(m.ano, m.mes)}
              </div>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {DIAS_SEMANA.map((d, i) => (
                  <div
                    key={`${d}-${i}`}
                    className={`text-center text-[10px] font-bold ${i === 0 ? 'text-red-300' : 'text-omega-400'}`}
                    title={i === 0 ? 'Domingo — dia não útil (fora da auditoria)' : undefined}
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {celulasDoMes(m.ano, m.mes).map((iso, i) => {
                  if (!iso) return <div key={`vazio-${i}`} />;
                  const ehDomingo = diaSemanaISO(iso) === 0;
                  const bloq = bloqueado(iso);
                  const sel = selecionadasSet.has(iso);
                  const emPreview = !!faixaPreview && !bloq && iso >= faixaPreview.ini && iso <= faixaPreview.fim;
                  const contagem = contagensMap.get(iso);
                  const ehHoje = iso === hoje;

                  let titulo = 'Sem auditoria nesta consulta';
                  if (ehDomingo) titulo = 'Domingo — dia não útil (fora da auditoria)';
                  else if (iso > hoje) titulo = 'Data futura — fora da auditoria';
                  else if (contagem !== undefined && contagem > 0) titulo = `${contagem} pendência(s) de lançamento`;
                  else if (contagem === 0) titulo = 'Sem pendências';

                  const classes = [
                    'relative w-full h-8 md:h-9 rounded-md text-[11px] font-semibold flex items-center justify-center select-none transition-colors',
                    bloq
                      ? 'text-omega-300 cursor-not-allowed'
                      : sel
                        ? 'bg-blue-600 text-white shadow-sm cursor-pointer'
                        : emPreview
                          ? 'bg-blue-100 text-blue-800 cursor-pointer'
                          : 'text-omega-700 hover:bg-blue-50 cursor-pointer',
                    ehHoje && !sel ? 'ring-1 ring-inset ring-omega-accent/70' : '',
                  ].join(' ');

                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={bloq}
                      aria-pressed={sel}
                      title={`${formatarData(iso)} — ${titulo}`}
                      onMouseDown={(e) => {
                        if (bloq || e.button !== 0) return;
                        e.preventDefault();
                        setArrasto({ ancora: iso, atual: iso });
                      }}
                      onMouseEnter={() => {
                        if (!arrasto || bloq) return;
                        setArrasto((a) => (a ? { ...a, atual: iso } : a));
                      }}
                      onClick={(e) => {
                        // Acessibilidade: Enter/Espaço geram click com detail 0.
                        if (e.detail === 0 && !bloq) aplicar({ ancora: iso, atual: iso });
                      }}
                      className={classes}
                    >
                      {Number(iso.slice(8, 10))}
                      {contagem !== undefined && contagem > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-[2px] rounded-full bg-amber-500 text-white text-[8px] font-extrabold flex items-center justify-center leading-none">
                          {contagem > 9 ? '9+' : contagem}
                        </span>
                      )}
                      {contagem === 0 && (
                        <span
                          className={`absolute bottom-0.5 right-0.5 w-1 h-1 rounded-full ${sel ? 'bg-emerald-300' : 'bg-emerald-500'}`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legenda dos marcadores */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-omega-500">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-[4px] bg-blue-600 inline-block" /> Selecionado
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Com pendências
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Sem pendências
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-[4px] border border-omega-200 bg-omega-50 inline-block" /> Domingo / futuro
        </span>
      </div>
    </div>
  );
}
