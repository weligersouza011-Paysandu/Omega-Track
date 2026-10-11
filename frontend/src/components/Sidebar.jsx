import { NavLink } from 'react-router-dom';
import { Truck, ClipboardList, ShieldAlert, ChevronLeft, ChevronRight, Menu } from 'lucide-react';

const MENU = [
  { to: '/frota', label: 'Mobilizacao & Frota', icon: Truck, exact: false },
  { to: '/pendencias-parte-diaria', label: 'Partes Diarias', icon: ClipboardList, exact: true },
  { to: '/telemetria', label: 'Telemetria & Seguranca', icon: ShieldAlert, exact: true },
];

export default function Sidebar({ open, onToggle }) {
  return (
    <aside
      className={
        'fixed left-0 top-0 h-screen bg-white border-r border-omega-200 flex flex-col transition-all duration-200 z-30 ' +
        (open ? 'w-72' : 'w-16')
      }
    >
      <div className={'h-14 flex items-center justify-between px-4 border-b border-omega-200 shrink-0'}>
        <div className="flex items-center gap-3 overflow-hidden min-w-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-omega-accent to-indigo-500 flex items-center justify-center font-extrabold text-white shrink-0 text-lg shadow-sm">
            Ω
          </div>
          {open && (
            <div className="min-w-0 whitespace-nowrap">
              <div className="font-bold text-[15px] text-omega-900 leading-tight truncate">Omega Track</div>
              <div className="text-[11px] text-omega-500 leading-tight">Contrato CT251</div>
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
        {MENU.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className={({ isActive }) => {
              const base = 'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors';
              const active = isActive
                ? 'bg-omega-accent text-white shadow-sm'
                : 'text-omega-700 hover:bg-omega-100 hover:text-omega-900';
              return [
                base,
                active,
                open ? 'px-3 py-2.5' : 'px-0 py-2.5 justify-center',
              ].join(' ');
            }}
          >
            <item.icon size={20} className="shrink-0" />
            {open && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-omega-200 p-3">
        <div className={
          'flex items-center gap-2 text-[11px] text-omega-400 ' +
          (open ? '' : 'justify-center')
        }>
          <span className={'w-1.5 h-1.5 rounded-full bg-status-verde shrink-0 ' + (open ? '' : '')} />
          {open && <span>Sistema Online</span>}
        </div>
      </div>
    </aside>
  );
}
