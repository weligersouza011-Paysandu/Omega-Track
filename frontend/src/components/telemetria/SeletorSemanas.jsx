// Seletor de semanas do ano (ISO, segunda a domingo) que têm registro de telemetria.
// Seleção múltipla; a lista vem de /api/telemetria/semanas (mais recente primeiro).
import { useEffect, useRef, useState } from 'react';
import { CalendarRange, Check, ChevronDown } from 'lucide-react';

const dataCurta = (valor) => new Date(valor).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Belem' });

/** Texto do botão: "Sem. 44 e 45 · 26/10 a 08/11", "Sem. 45 · 02/11 a 08/11" ou "Todas as semanas". */
export function rotuloSemanas(selecionadas, semanas) {
  if (!selecionadas.length) return 'Todas as semanas';
  const lista = semanas.filter((s) => selecionadas.includes(s.chave)).sort((a, b) => a.chave.localeCompare(b.chave));
  if (!lista.length) return 'Semanas';
  const numeros = lista.map((s) => s.semana);
  const nomes = numeros.length === 1 ? `Sem. ${numeros[0]}`
    : numeros.length <= 3 ? `Sem. ${numeros.slice(0, -1).join(', ')} e ${numeros.at(-1)}`
      : `${numeros.length} semanas`;
  return `${nomes} · ${dataCurta(lista[0].inicio)} a ${dataCurta(lista.at(-1).fim)}`;
}

export default function SeletorSemanas({ semanas, selecionadas, onChange, padrao, carregando }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target)) setAberto(false); };
    const esc = (e) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const alternar = (chave) => onChange(selecionadas.includes(chave) ? selecionadas.filter((c) => c !== chave) : [...selecionadas, chave]);
  const anos = [...new Set(semanas.map((s) => s.ano))];

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        className="input flex w-auto min-w-[230px] items-center justify-between gap-2 text-left"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label="Semanas do ano"
        disabled={carregando}
      >
        <span className="flex items-center gap-2 truncate">
          <CalendarRange size={16} className="shrink-0 text-omega-accent" />
          {carregando ? 'Carregando semanas...' : semanas.length ? rotuloSemanas(selecionadas, semanas) : 'Sem registros'}
        </span>
        <ChevronDown size={16} className="shrink-0 text-omega-400" />
      </button>

      {aberto && (
        <div className="absolute right-0 z-30 mt-1 w-[320px] rounded-xl border border-omega-200 bg-white p-2 shadow-card-hover">
          <div className="mb-2 flex flex-wrap gap-1.5 border-b border-omega-100 pb-2">
            <button type="button" className="rounded-md bg-omega-100 px-2 py-1 text-[11px] font-bold text-omega-700 hover:bg-omega-200" onClick={() => onChange(padrao)}>
              Últimas 2 com registro
            </button>
            <button type="button" className="rounded-md bg-omega-100 px-2 py-1 text-[11px] font-bold text-omega-700 hover:bg-omega-200" onClick={() => onChange(semanas.slice(0, 4).map((s) => s.chave))}>
              Últimas 4
            </button>
            <button type="button" className="rounded-md bg-omega-100 px-2 py-1 text-[11px] font-bold text-omega-700 hover:bg-omega-200" onClick={() => onChange([])}>
              Todas
            </button>
          </div>
          <ul className="max-h-[320px] overflow-y-auto" role="listbox" aria-multiselectable="true">
            {anos.map((ano) => (
              <li key={ano}>
                {anos.length > 1 && <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-omega-400">{ano}</div>}
                <ul>
                  {semanas.filter((s) => s.ano === ano).map((s) => {
                    const marcada = selecionadas.includes(s.chave);
                    return (
                      <li key={s.chave}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={marcada}
                          onClick={() => alternar(s.chave)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${marcada ? 'bg-blue-50' : 'hover:bg-omega-50'}`}
                        >
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${marcada ? 'border-omega-accent bg-omega-accent text-white' : 'border-omega-300'}`}>
                            {marcada && <Check size={12} />}
                          </span>
                          <span className="w-16 font-bold text-omega-900">Sem. {s.semana}</span>
                          <span className="flex-1 text-omega-500">{dataCurta(s.inicio)} a {dataCurta(s.fim)}</span>
                          <span className="text-right tabular-nums text-omega-600" title={`${s.velocidade} velocidade · ${s.fadiga} fadiga · ${s.outros} outros`}>
                            {s.total.toLocaleString('pt-BR')} ev.
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
            {!semanas.length && <li className="px-2 py-3 text-center text-xs text-omega-500">Nenhuma semana com registro. Importe a planilha da plataforma.</li>}
          </ul>
          <p className="mt-2 border-t border-omega-100 px-1 pt-2 text-[10px] text-omega-400">
            Semanas ISO (segunda a domingo). Nenhuma marcada = todas. A recorrência da matriz sempre conta o mês inteiro.
          </p>
        </div>
      )}
    </div>
  );
}
