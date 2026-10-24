import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import Header from '../components/Header.jsx';

export default function AppLayout({ sessao, onSair, tema, onAlternarTema }) {
  // Mobile (<768px): sidebar inicia fechada; abre como gaveta (drawer).
  // Desktop: inicia aberta.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 768
  );

  return (
    <div className="app-layout min-h-screen flex bg-omega-50">
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} usuario={sessao?.usuario} />
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-slate-900/50 z-30 md:hidden"
          aria-hidden="true"
        />
      )}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${sidebarOpen ? 'ml-0 md:ml-72' : 'ml-0 md:ml-16'}`}>
        <Header usuario={sessao?.usuario} onSair={onSair} onMenu={() => setSidebarOpen((v) => !v)}
          tema={tema} onAlternarTema={onAlternarTema} />
        <main className="flex-1 px-3 py-2 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
