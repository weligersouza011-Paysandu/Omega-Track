import { Search, Menu, Clock } from 'lucide-react';

export default function Header() {
  const hoje = new Date();
  const dataFormatada = hoje.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });

  return (
    <header className="h-16 bg-white border-b border-omega-200 px-6 flex items-center gap-4 sticky top-0 z-20 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <button className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-omega-100 text-omega-600">
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
    </header>
  );
}
