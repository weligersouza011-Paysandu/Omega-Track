import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Menu, Clock, LogOut, ShieldCheck } from 'lucide-react';
import { lerSessao, authHeaders } from '../utils/sessao.js';
import { ehOperacional } from '../utils/permissoes.js';

export default function Header({ usuario, onSair, onMenu }) {
  const hoje = new Date();
  const dataFormatada = hoje.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
  const inicial = String(usuario?.nome || '?').trim().charAt(0).toUpperCase();

  // Operador: badge pulsante com o numero de dias pendentes de lancamento
  // (pendencias vinculadas a ele na auditoria do backend).
  const operacional = ehOperacional(usuario);
  const [pendenciasDias, setPendenciasDias] = useState(0);
  useEffect(() => {
    if (!operacional) {
      setPendenciasDias(0);
      return undefined;
    }
    let vivo = true;
    (async () => {
      try {
        const resp = await fetch(`/api/partes-diarias/pendencias?_t=${Date.now()}`, {
          headers: authHeaders(lerSessao()),
        });
        if (!resp.ok) return;
        const corpo = await resp.json();
        if (vivo) setPendenciasDias(Array.isArray(corpo?.data) ? corpo.data.length : 0);
      } catch {
        /* badge e informativo: falha silenciosa */
      }
    })();
    return () => { vivo = false; };
  }, [operacional, usuario?.matricula]);

  return (
    <header className="h-16 bg-white border-b border-omega-200 px-6 flex items-center gap-4 sticky top-0 z-20 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <button
        onClick={onMenu}
        title="Abrir menu"
        aria-label="Abrir menu"
        className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-omega-100 text-omega-600"
      >
        <Menu size={20} />
      </button>

      <div className="hidden md:block w-80 shrink-0" />

      <div className="flex items-center justify-center gap-2 text-omega-500 text-sm flex-1 min-w-0">
        <Clock size={16} />
        <span className="capitalize text-center truncate">{dataFormatada}</span>
      </div>

      <div className="hidden md:flex items-center gap-2 w-80 ml-auto">
        <div className="relative w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
          <input
            type="text"
            placeholder="Buscar TAG, placa, funcionario..."
            className="input pl-9 bg-omega-50"
          />
        </div>
      </div>

      {usuario && (
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/perfil"
            title="Meu perfil"
            className="flex items-center gap-2 rounded-xl hover:bg-omega-100 pl-1 pr-2 py-1 transition-colors"
          >
            <span
              className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-omega-accent flex items-center justify-center font-black text-white text-sm"
              title={operacional && pendenciasDias > 0 ? `${pendenciasDias} dia(s) com lançamento pendente` : undefined}
            >
              {inicial}
              {operacional && pendenciasDias > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white ring-2 ring-white">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                  <span className="relative">{pendenciasDias}</span>
                </span>
              )}
            </span>
            <span className="hidden xl:block text-left leading-tight">
              <span className="block text-xs font-extrabold text-omega-900 truncate max-w-[120px]">
                {usuario.nome}
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold text-omega-500">
                {usuario.nivel === 'MASTER' && <ShieldCheck size={10} className="text-violet-600" />}
                {usuario.nivel}
              </span>
            </span>
          </Link>
          <button
            onClick={onSair}
            title="Sair"
            className="p-2 rounded-lg hover:bg-red-50 text-omega-400 hover:text-red-600 transition-colors"
          >
            <LogOut size={17} />
          </button>
        </div>
      )}
    </header>
  );
}
