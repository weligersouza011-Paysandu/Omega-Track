import { NavLink } from 'react-router-dom';
import { Home, Building2, Truck, Gauge, TrendingUp, ShieldAlert, Leaf, Sprout, Users, ChevronLeft, Menu } from 'lucide-react';
import { ehOperacional } from '../utils/permissoes.js';

const SECTIONS = [
  {
    titulo: 'Transporte',
    theme: 'base',
    itens: [
      { to: '/inicio', label: 'Início', icon: Home, exact: true },
      { to: '/obras', label: 'Obras', icon: Building2, exact: true },
      { to: '/frota', label: 'Mobilizacao & Frota', icon: Truck, exact: false },
      { to: '/preditiva', label: 'Gantt de Preventivas', icon: Gauge, exact: true },
      { to: '/gestao-eficiencia', label: 'Gestão de Eficiência', icon: TrendingUp, exact: true },
      { to: '/telemetria', label: 'Telemetria & Seguranca', icon: ShieldAlert, exact: true },
    ],
  },
  {
    titulo: 'Meio Ambiente',
    theme: 'eco',
    itens: [
      { to: '/controle-ambiental', label: 'Controle Ambiental da Frota', icon: Leaf, exact: true },
      { to: '/ecogestao', label: 'EcoGestao', icon: Sprout, exact: true },
    ],
  },
  {
    titulo: 'Administracao',
    theme: 'admin',
    itens: [
      { to: '/usuarios', label: 'Gestao de Usuarios', icon: Users, exact: true },
    ],
  },
];

const THEMES = {
  base: {
    active: 'bg-omega-accent text-white shadow-sm',
    idle: 'text-omega-700 hover:bg-omega-100 hover:text-omega-900',
    iconIdle: '',
    header: 'text-omega-400',
    bar: 'bg-omega-300',
  },
  eco: {
    active: 'bg-emerald-500 text-white shadow-sm',
    idle: 'text-omega-700 hover:bg-emerald-50 hover:text-emerald-800',
    iconIdle: 'text-emerald-500',
    header: 'text-emerald-600',
    bar: 'bg-emerald-300',
  },
  admin: {
    active: 'bg-violet-500 text-white shadow-sm',
    idle: 'text-omega-700 hover:bg-violet-50 hover:text-violet-800',
    iconIdle: 'text-violet-500',
    header: 'text-violet-600',
    bar: 'bg-violet-300',
  },
};

function itemClasses(isActive, open, theme) {
  const t = THEMES[theme] || THEMES.base;
  const base = 'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors relative';
  return [base, isActive ? t.active : t.idle, open ? 'px-3 py-2.5' : 'px-0 py-2.5 justify-center'].join(' ');
}

export default function Sidebar({ open, onToggle, usuario }) {
  // Perfil operacional: enxerga APENAS o Início. Todo o resto (frota,
  // ambiental, gestão) fica oculto no menu E bloqueado nas rotas (App.jsx).
  const secoes = ehOperacional(usuario)
    ? [{ titulo: 'Principal', theme: 'base', itens: [{ to: '/inicio', label: 'Início', icon: Home, exact: true }] }]
    : SECTIONS;
  return (
    <aside
      className={
        'fixed left-0 top-0 h-screen bg-white border-r border-omega-200 flex flex-col transition-all duration-200 z-40 ' +
        (open ? 'w-72' : 'w-72 -translate-x-full md:w-16 md:translate-x-0')
      }
    >
      <div className={'h-16 flex items-center justify-between px-3.5 border-b border-omega-200 shrink-0 bg-white'}>
        <div className="flex items-center gap-3 overflow-hidden min-w-0">
          <div className="w-10 h-10 rounded-lg bg-white border border-omega-200 shadow-sm flex items-center justify-center p-0.5 shrink-0 overflow-hidden">
            <img
              src="/logo/logo-redonda.png"
              alt="Omega"
              className="w-full h-full object-contain"
              onError={(e) => {
                if (!e.target.dataset.fb) {
                  e.target.dataset.fb = '1';
                  e.target.src = '/logo/0.png';
                }
              }}
            />
          </div>
          {open && (
            <div className="min-w-0 whitespace-nowrap">
              <div className="font-extrabold text-[15px] text-omega-950 leading-tight truncate flex items-center gap-1.5">
                <span>Omega Track</span>
                <span className="w-1.5 h-1.5 rounded-full bg-omega-brand" />
              </div>
              <div className="text-[11px] font-semibold text-omega-500 leading-tight truncate">
                Serviços e Montagens Industriais
              </div>
            </div>
          )}
        </div>
        <button
          onClick={onToggle}
          className={'p-1.5 rounded-lg hover:bg-omega-100 text-omega-500 hover:text-omega-900 transition-colors shrink-0 ' + (open ? '' : 'mx-auto')}
          title={open ? 'Recolher menu' : 'Expandir menu'}
        >
          {open ? <ChevronLeft size={18} /> : <Menu size={18} />}
        </button>
      </div>

      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {secoes.map((sec) => (
          <div key={sec.titulo}>
            {open ? (
              <div className={'pb-1 px-3 text-[10px] font-bold uppercase tracking-widest ' + THEMES[sec.theme].header}>
                {sec.titulo}
              </div>
            ) : (
              <div className="pb-1 flex justify-center">
                <span className={'w-6 h-px ' + THEMES[sec.theme].bar} />
              </div>
            )}
            <div className="space-y-1 pb-2">
              {sec.itens.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.exact}
                  title={item.label}
                  className={({ isActive }) => itemClasses(isActive, open, sec.theme)}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        size={20}
                        className={'shrink-0 ' + (isActive ? 'text-white' : THEMES[sec.theme].iconIdle)}
                      />
                      {open && <span className="truncate">{item.label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-omega-200 p-3 bg-omega-50/60">
        <div className={
          'flex items-center gap-2 text-[11px] text-omega-600 font-medium ' +
          (open ? 'justify-between' : 'justify-center')
        }>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-status-verde ring-2 ring-emerald-200 shrink-0" />
            {open && <span className="font-semibold text-omega-700">Sistema Conectado</span>}
          </div>
          {open && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-white border border-omega-200 text-omega-500">
              CT251
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
