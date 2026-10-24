import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function PessoaSearchSelect({ id, rotulo, matricula, nomeSalvo, pessoas, onChange, disabled }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [indiceAtivo, setIndiceAtivo] = useState(-1);
  const [posicao, setPosicao] = useState(null);
  const raizRef = useRef(null);
  const botaoRef = useRef(null);
  const painelRef = useRef(null);
  const buscaRef = useRef(null);
  const listaId = useId();
  const pessoaAtual = pessoas.find((pessoa) => pessoa.matricula === matricula);
  const nomeAtual = pessoaAtual?.nome || nomeSalvo;

  const opcoes = useMemo(() => {
    const termo = normalizar(busca.trim());
    const semPessoa = !termo || normalizar(`Sem ${rotulo}`).includes(termo)
      ? [{ matricula: null, nome: `Sem ${rotulo}` }]
      : [];
    return [
      ...semPessoa,
      ...pessoas.filter((pessoa) => normalizar(`${pessoa.nome} ${pessoa.matricula} ${pessoa.funcao || ''}`).includes(termo)),
    ];
  }, [busca, pessoas, rotulo]);

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

  useEffect(() => {
    if (disabled) setAberto(false);
  }, [disabled]);

  useEffect(() => {
    if (aberto && indiceAtivo >= 0) {
      document.getElementById(`${listaId}-${indiceAtivo}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [aberto, indiceAtivo, listaId]);

  function calcularPosicao() {
    const rect = botaoRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const largura = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
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

  function selecionar(valor) {
    setAberto(false);
    setBusca('');
    onChange(valor);
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
      selecionar(opcoes[indiceAtivo].matricula);
    }
  }

  return (
    <div ref={raizRef}>
      <button ref={botaoRef} id={id} type="button" disabled={disabled}
        onClick={() => {
          if (aberto) setAberto(false);
          else {
            setBusca('');
            setIndiceAtivo(-1);
            setPosicao(calcularPosicao());
            setAberto(true);
          }
        }}
        aria-haspopup="listbox" aria-expanded={aberto} aria-controls={aberto ? listaId : undefined}
        className="input w-full flex items-center justify-between gap-2 text-left disabled:opacity-50 disabled:cursor-not-allowed">
        <span className={`truncate ${matricula ? 'text-omega-900' : 'text-omega-500'}`}>
          {matricula ? `${nomeAtual || matricula} · ${matricula}` : `Selecionar ${rotulo}`}
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
              onKeyDown={aoTeclar} role="combobox" aria-expanded="true" aria-autocomplete="list"
              aria-label={`Pesquisar ${rotulo} por nome, matrícula ou função`}
              aria-controls={listaId}
              aria-activedescendant={indiceAtivo >= 0 ? `${listaId}-${indiceAtivo}` : undefined}
              placeholder="Nome, matrícula ou função" className="input pl-9" />
          </div>
          <div id={listaId} role="listbox" aria-label={`${rotulo} disponível`} className="mt-2 max-h-60 overflow-y-auto">
            {opcoes.length === 0 ? (
              <div className="px-3 py-3 text-xs text-omega-500">Nenhum usuário encontrado.</div>
            ) : opcoes.map((pessoa, indice) => (
              <button key={pessoa.matricula || 'sem-pessoa'} id={`${listaId}-${indice}`}
                type="button" role="option" aria-selected={matricula === pessoa.matricula}
                onMouseEnter={() => setIndiceAtivo(indice)} onClick={() => selecionar(pessoa.matricula)}
                className={`w-full rounded-lg px-3 py-2 text-left flex items-start gap-2 text-sm ${indice === indiceAtivo ? 'bg-omega-100' : 'hover:bg-omega-50'}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-omega-900">{pessoa.nome}</span>
                  {pessoa.matricula && <span className="block text-xs text-omega-500">{pessoa.matricula}{pessoa.funcao ? ` · ${pessoa.funcao}` : ''}</span>}
                </span>
                {matricula === pessoa.matricula && <Check size={15} className="shrink-0 text-omega-accent mt-0.5" />}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
