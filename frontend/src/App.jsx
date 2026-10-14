import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import HomePartesDiariasView from './views/HomePartesDiariasView.jsx';
import ObrasView from './views/ObrasView.jsx';
import DashboardView from './views/DashboardView.jsx';
import MobDesmobView from './views/MobDesmobView.jsx';
import DashboardExecutivoView from './views/DashboardExecutivoView.jsx';
import FarolDocumentosView from './views/FarolDocumentosView.jsx';
import PendenciasParteDiariaView from './views/PendenciasParteDiariaView.jsx';
import TelemetriaView from './views/TelemetriaView.jsx';
import ControleAmbientalView from './views/ControleAmbientalView.jsx';
import EcoGestaoView from './views/EcoGestaoView.jsx';
import UsuariosView from './views/UsuariosView.jsx';
import PerfilView from './views/PerfilView.jsx';
import LoginView from './views/LoginView.jsx';
import { lerSessao, encerrarSessao } from './utils/sessao.js';

export default function App() {
  const [sessao, setSessao] = useState(() => lerSessao());

  if (!sessao?.token) {
    return <LoginView onLogin={(s) => setSessao(s)} />;
  }

  const sair = () => {
    encerrarSessao();
    setSessao(null);
  };

  return (
    <Routes>
      <Route path="/" element={<AppLayout sessao={sessao} onSair={sair} />}>
        <Route index element={<HomePartesDiariasView sessao={sessao} />} />
        <Route path="inicio" element={<HomePartesDiariasView sessao={sessao} />} />
        <Route path="obras" element={<ObrasView sessao={sessao} />} />
        <Route path="visao-geral" element={<DashboardView />} />
        <Route path="executivo" element={<DashboardExecutivoView />} />
        <Route path="frota" element={<MobDesmobView />} />
        <Route path="farol-documentos" element={<FarolDocumentosView />} />
        <Route path="pendencias-parte-diaria" element={<PendenciasParteDiariaView />} />
        <Route path="telemetria" element={<TelemetriaView />} />
        <Route path="controle-ambiental" element={<ControleAmbientalView />} />
        <Route path="ecogestao" element={<EcoGestaoView />} />
        <Route path="usuarios" element={<UsuariosView sessao={sessao} />} />
        <Route path="perfil" element={<PerfilView sessao={sessao} />} />
      </Route>
    </Routes>
  );
}
