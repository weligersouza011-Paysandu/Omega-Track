import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import Header from '../components/Header.jsx';

export default function AppLayout({ sessao, onSair }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen flex bg-omega-50">
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} usuario={sessao?.usuario} />
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${sidebarOpen ? 'ml-72' : 'ml-16'}`}>
        <Header usuario={sessao?.usuario} onSair={onSair} />
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
