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
    <header className="h-16 bg-white border-b border-omega-200 px-4 md:px-6 flex items-center gap-3 md:gap-4 sticky top-0 z-20 shadow-[0_1px_2px_rgba(15,23,42,0.03)] relative">
      {/* Linha fina com o gradiente da marca corporativa Omega */}
      <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-omega-brand via-omega-accent to-omega-950" />

      {/* Botão de menu gaveta no mobile */}
      <button
        onClick={onMenu}
        title="Abrir menu de navegação"
        aria-label="Abrir menu de navegação"
        className="md:hidden p-2 -ml-1 rounded-lg hover:bg-omega-100 text-omega-700 transition-colors shrink-0"
      >
        <Menu size={20} />
      </button>

      {/* Identidade Corporativa Omega Oficial (Alinhada à Esquerda) */}
      <div className="flex items-center gap-3 shrink-0">
        <Link to="/inicio" className="flex items-center gap-2.5 md:gap-3 group focus:outline-none" title="Omega Track · Gestão Operacional">
          <div className="flex items-center justify-center p-0.5 rounded-full bg-white border border-omega-200/90 shadow-sm group-hover:border-omega-brand/50 transition-colors">
            <img
              src="/logo/omega-circle.png"
              alt="Omega Serviços e Montagens Industriais"
              className="h-8 md:h-9 w-8 md:w-9 rounded-full object-contain shrink-0"
              onError={(e) => {
                if (!e.target.dataset.fb) {
                  e.target.dataset.fb = '1';
                  e.target.src = '/logo/logo-redonda.png';
                }
              }}
            />
          </div>
          <div className="flex flex-col text-left leading-tight">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm md:text-base tracking-tight text-omega-950 group-hover:text-omega-brand transition-colors">
                Omega Track
              </span>
              <span className="hidden xl:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-omega-brand/10 text-omega-brand border border-omega-brand/20 uppercase tracking-wider">
                Industrial
              </span>
            </div>
            <span className="text-[10px] md:text-[11px] font-medium text-omega-500 hidden sm:block truncate max-w-[220px] md:max-w-none">
              Omega Track · Gestão Operacional
            </span>
          </div>
        </Link>
      </div>

      {/* Centro: Data e Turno */}
      <div className="flex items-center justify-center gap-2 text-omega-500 text-xs md:text-sm flex-1 min-w-0">
        <Clock size={15} className="shrink-0 text-omega-400 hidden sm:block" />
        <span className="capitalize text-center truncate">{dataFormatada}</span>
      </div>

      {/* Direita: Busca Operacional */}
      <div className="hidden lg:flex items-center gap-2 w-72 ml-auto">
        <div className="relative w-full">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
          <input
            type="text"
            placeholder="Buscar TAG, placa, colaborador..."
            className="input pl-9 text-xs bg-omega-50/80 border-omega-200 focus:bg-white transition-colors"
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
