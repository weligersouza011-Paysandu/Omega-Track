import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import HomePartesDiariasView from './views/HomePartesDiariasView.jsx';
import ObrasView from './views/ObrasView.jsx';
import DashboardView from './views/DashboardView.jsx';
import MobDesmobView from './views/MobDesmobView.jsx';
import GestaoPreditivaView from './views/GestaoPreditivaView.jsx';
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
import { ehOperacional } from './utils/permissoes.js';

// Guarda de rota: perfil OPERACIONAL só acessa o Início (/ e /inicio).
// Qualquer URL direta restrita redireciona para /inicio.
function RestritoAdmin({ children, operacional }) {
  if (operacional) return <Navigate to="/inicio" replace />;
  return children;
}

export default function App() {
  const [sessao, setSessao] = useState(() => lerSessao());

  if (!sessao?.token) {
    return <LoginView onLogin={(s) => setSessao(s)} />;
  }

  const sair = () => {
    encerrarSessao();
    setSessao(null);
  };

  const operacional = ehOperacional(sessao?.usuario);

  return (
    <Routes>
      <Route path="/" element={<AppLayout sessao={sessao} onSair={sair} />}>
        <Route index element={<HomePartesDiariasView sessao={sessao} />} />
        <Route path="inicio" element={<HomePartesDiariasView sessao={sessao} />} />
        <Route path="obras" element={<RestritoAdmin operacional={operacional}><ObrasView sessao={sessao} /></RestritoAdmin>} />
        <Route path="visao-geral" element={<RestritoAdmin operacional={operacional}><DashboardView /></RestritoAdmin>} />
        <Route path="executivo" element={<RestritoAdmin operacional={operacional}><DashboardExecutivoView /></RestritoAdmin>} />
        <Route path="frota" element={<RestritoAdmin operacional={operacional}><MobDesmobView /></RestritoAdmin>} />
        <Route path="preditiva" element={<RestritoAdmin operacional={operacional}><GestaoPreditivaView /></RestritoAdmin>} />
        <Route path="farol-documentos" element={<RestritoAdmin operacional={operacional}><FarolDocumentosView /></RestritoAdmin>} />
        <Route path="pendencias-parte-diaria" element={<RestritoAdmin operacional={operacional}><PendenciasParteDiariaView /></RestritoAdmin>} />
        <Route path="telemetria" element={<RestritoAdmin operacional={operacional}><TelemetriaView /></RestritoAdmin>} />
        <Route path="controle-ambiental" element={<RestritoAdmin operacional={operacional}><ControleAmbientalView /></RestritoAdmin>} />
        <Route path="ecogestao" element={<RestritoAdmin operacional={operacional}><EcoGestaoView /></RestritoAdmin>} />
        <Route path="usuarios" element={<RestritoAdmin operacional={operacional}><UsuariosView sessao={sessao} /></RestritoAdmin>} />
        <Route path="perfil" element={<RestritoAdmin operacional={operacional}><PerfilView sessao={sessao} /></RestritoAdmin>} />
      </Route>
    </Routes>
  );
}
