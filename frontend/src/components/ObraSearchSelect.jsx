import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function ObraSearchSelect({ id, obraAtual, obrasAtivas, disabled, onChange }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [indiceAtivo, setIndiceAtivo] = useState(-1);
  const [posicao, setPosicao] = useState(null);
  const raizRef = useRef(null);
  const buscaRef = useRef(null);
  const botaoRef = useRef(null);
  const painelRef = useRef(null);
  const listaId = useId();

  const opcoes = useMemo(() => {
    const termo = normalizar(busca.trim());
    const semProgramacao = !termo || normalizar('Sem programação').includes(termo)
      ? [{ id: '', nome: 'Sem programação', numeroContrato: null }]
      : [];
    const obras = obrasAtivas.filter((obra) =>
      normalizar(`${obra.nome} ${obra.numeroContrato || ''}`).includes(termo)
    );
    return [...semProgramacao, ...obras];
  }, [busca, obrasAtivas]);

  useEffect(() => {
    if (!aberto) return undefined;
    buscaRef.current?.focus();
    const fecharFora = (evento) => {
      if (!raizRef.current?.contains(evento.target) && !painelRef.current?.contains(evento.target)) {
        setAberto(false);
      }
    };
    document.addEventListener('pointerdown', fecharFora);
    return () => document.removeEventListener('pointerdown', fecharFora);
  }, [aberto]);

  function calcularPosicao() {
    const rect = botaoRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const largura = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
    const espacoAbaixo = window.innerHeight - rect.bottom - 8;
    const espacoAcima = rect.top - 8;
    const abrirAcima = espacoAbaixo < 320 && espacoAcima > espacoAbaixo;
    return {
      left: Math.max(8, Math.min(rect.left, window.innerWidth - largura - 8)),
      width: largura,
      top: abrirAcima ? undefined : rect.bottom + 4,
      bottom: abrirAcima ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: Math.min(320, Math.max(120, abrirAcima ? espacoAcima : espacoAbaixo)),
    };
  }

  useLayoutEffect(() => {
    if (!aberto) return undefined;
    const atualizar = () => setPosicao(calcularPosicao());
    document.addEventListener('scroll', atualizar, true);
    window.addEventListener('resize', atualizar);
    return () => {
      document.removeEventListener('scroll', atualizar, true);
      window.removeEventListener('resize', atualizar);
    };
  }, [aberto]);

  useEffect(() => {
    if (disabled) setAberto(false);
  }, [disabled]);

  useEffect(() => {
    if (aberto && indiceAtivo >= 0) {
      document.getElementById(`${listaId}-${indiceAtivo}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [aberto, indiceAtivo, listaId]);

  function abrir() {
    if (disabled) return;
    setBusca('');
    setIndiceAtivo(-1);
    setPosicao(calcularPosicao());
    setAberto(true);
  }

  function selecionar(obraId) {
    setAberto(false);
    setBusca('');
    onChange(obraId);
    botaoRef.current?.focus();
  }

  function aoTeclar(evento) {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      setAberto(false);
      botaoRef.current?.focus();
    } else if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      if (opcoes.length) setIndiceAtivo((atual) => Math.min(atual + 1, opcoes.length - 1));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (opcoes.length) setIndiceAtivo((atual) => Math.max(atual - 1, 0));
    } else if (evento.key === 'Enter' && indiceAtivo >= 0 && opcoes[indiceAtivo]) {
      evento.preventDefault();
      selecionar(opcoes[indiceAtivo].id);
    }
  }

  return (
    <div ref={raizRef} className="relative">
      <button ref={botaoRef} id={id} type="button" disabled={disabled}
        onClick={() => aberto ? setAberto(false) : abrir()}
        aria-haspopup="listbox" aria-expanded={aberto} aria-controls={aberto ? listaId : undefined}
        className="input w-full flex items-center justify-between gap-2 text-left disabled:opacity-50 disabled:cursor-not-allowed">
        <span className={`truncate ${obraAtual ? 'text-omega-900' : 'text-omega-500'}`}>
          {obraAtual
            ? `${obraAtual.nome}${obraAtual.ativo ? '' : ' (inativa)'}${obraAtual.numeroContrato ? ` · ${obraAtual.numeroContrato}` : ''}`
            : 'Sem programação'}
        </span>
        <ChevronDown size={16} className="shrink-0 text-omega-400" />
      </button>

      {aberto && posicao && createPortal(
        <div ref={painelRef} style={posicao}
          className="theme-select-portal fixed z-[100] overflow-y-auto rounded-xl border border-omega-200 bg-white shadow-xl p-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
            <input ref={buscaRef} type="search" value={busca}
              onChange={(evento) => { setBusca(evento.target.value); setIndiceAtivo(-1); }}
              onKeyDown={aoTeclar}
              role="combobox" aria-expanded="true" aria-autocomplete="list"
              aria-label="Pesquisar obra por nome ou contrato"
              aria-controls={listaId} aria-activedescendant={indiceAtivo >= 0 ? `${listaId}-${indiceAtivo}` : undefined}
              placeholder="Pesquisar obra ou contrato"
              className="input pl-9" />
          </div>
          <div id={listaId} role="listbox" aria-label="Obras disponíveis" className="mt-2 max-h-60 overflow-y-auto">
            {opcoes.length === 0 ? (
              <div className="px-3 py-3 text-xs text-omega-500">Nenhuma obra encontrada.</div>
            ) : opcoes.map((obra, indice) => (
              <button key={obra.id || 'sem-programacao'} id={`${listaId}-${indice}`}
                type="button" role="option" aria-selected={(obraAtual?.id || '') === obra.id}
                onMouseEnter={() => setIndiceAtivo(indice)}
                onClick={() => selecionar(obra.id)}
                className={`w-full rounded-lg px-3 py-2 text-left flex items-start gap-2 text-sm ${indice === indiceAtivo ? 'bg-omega-100' : 'hover:bg-omega-50'}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-omega-900">{obra.nome}</span>
                  {obra.numeroContrato && <span className="block text-xs text-omega-500">{obra.numeroContrato}</span>}
                </span>
                {(obraAtual?.id || '') === obra.id && <Check size={15} className="shrink-0 text-omega-accent mt-0.5" />}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
