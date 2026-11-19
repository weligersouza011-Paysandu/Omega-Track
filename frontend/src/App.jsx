import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import HomePartesDiariasView from './views/HomePartesDiariasView.jsx';
import ObrasView from './views/ObrasView.jsx';
import ProgramacaoRecursosView from './views/ProgramacaoRecursosView.jsx';
import DashboardView from './views/DashboardView.jsx';
import MobDesmobView from './views/MobDesmobView.jsx';
import GestaoPreditivaView from './views/GestaoPreditivaView.jsx';
import DashboardExecutivoView from './views/DashboardExecutivoView.jsx';
import FarolDocumentosView from './views/FarolDocumentosView.jsx';
import GestaoEficienciaView from './views/GestaoEficienciaView.jsx';
import TelemetriaView from './views/TelemetriaView.jsx';
import ControleAmbientalView from './views/ControleAmbientalView.jsx';
import ControleCombustivelView from './views/ControleCombustivelView.jsx';
import EcoGestaoView from './views/EcoGestaoView.jsx';
import UsuariosView from './views/UsuariosView.jsx';
import PerfilView from './views/PerfilView.jsx';
import LoginView from './views/LoginView.jsx';
import { lerSessao, encerrarSessao } from './utils/sessao.js';
import { aoMudarSessao } from './offline/index.js';
import { ehOperacional, ehTransporteSomente, podeVerModulo } from './utils/permissoes.js';
import { rotaInicialPorSetor } from './utils/sessao.js';

const CHAVE_TEMA = 'omegatrack-tema';

function temaSalvo() {
  try {
    return localStorage.getItem(CHAVE_TEMA) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// Guarda de rota: perfil OPERACIONAL só acessa o Início (/ e /inicio).
// Qualquer URL direta restrita redireciona para /inicio.
// Cada setor tambem so abre os seus modulos (Meio Ambiente: ambientais + mobilizacao);
// fora disso volta para a tela inicial do setor.
function RestritoAdmin({ children, operacional, usuario, modulo }) {
  if (operacional) return <Navigate to="/inicio" replace />;
  if (modulo && !podeVerModulo(usuario, modulo)) return <Navigate to={rotaInicialPorSetor(usuario)} replace />;
  return children;
}

// Transporte acompanha os modulos ambientais somente em leitura.
function AvisoSomenteLeitura({ usuario, children }) {
  if (!ehTransporteSomente(usuario)) return children;
  return (
    <>
      <div className="mb-4 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
        Você acompanha este módulo em modo leitura: lançamentos, importações e exclusões são do setor Meio Ambiente.
      </div>
      {children}
    </>
  );
}

// Tela inicial (partes diarias): Meio Ambiente comeca no modulo dele.
function Inicio({ usuario, children }) {
  if (!podeVerModulo(usuario, 'inicio')) return <Navigate to={rotaInicialPorSetor(usuario)} replace />;
  return children;
}

export default function App() {
  const [sessao, setSessao] = useState(() => lerSessao());
  const [tema, setTema] = useState(temaSalvo);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', tema === 'dark');
    try {
      localStorage.setItem(CHAVE_TEMA, tema);
    } catch {
      // A alternância continua válida nesta sessão mesmo sem armazenamento local.
    }
  }, [tema]);

  if (!sessao?.token) {
    return <LoginView onLogin={(s) => { setSessao(s); aoMudarSessao(); }} tema={tema}
      onAlternarTema={() => setTema((atual) => atual === 'dark' ? 'light' : 'dark')} />;
  }

  const sair = () => {
    encerrarSessao();
    setSessao(null);
  };

  const operacional = ehOperacional(sessao?.usuario);

  return (
    <Routes>
      <Route path="/" element={<AppLayout sessao={sessao} onSair={sair} tema={tema}
        onAlternarTema={() => setTema((atual) => atual === 'dark' ? 'light' : 'dark')} />}>
        <Route index element={<Inicio usuario={sessao?.usuario}><HomePartesDiariasView sessao={sessao} /></Inicio>} />
        <Route path="inicio" element={<Inicio usuario={sessao?.usuario}><HomePartesDiariasView sessao={sessao} /></Inicio>} />
        <Route path="obras" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="obras"><ObrasView sessao={sessao} /></RestritoAdmin>} />
        <Route path="programacao-recursos" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="programacao-recursos"><ProgramacaoRecursosView sessao={sessao} /></RestritoAdmin>} />
        <Route path="visao-geral" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="inicio"><DashboardView /></RestritoAdmin>} />
        <Route path="executivo" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="inicio"><DashboardExecutivoView /></RestritoAdmin>} />
        <Route path="frota" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="frota"><MobDesmobView sessao={sessao} /></RestritoAdmin>} />
        <Route path="preditiva" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="preditiva"><GestaoPreditivaView /></RestritoAdmin>} />
        <Route path="farol-documentos" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="inicio"><FarolDocumentosView /></RestritoAdmin>} />
        <Route path="gestao-eficiencia" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="gestao-eficiencia"><GestaoEficienciaView sessao={sessao} /></RestritoAdmin>} />
        <Route path="pendencias-parte-diaria" element={<Navigate to="/inicio" replace />} />
        <Route path="telemetria" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="telemetria"><TelemetriaView /></RestritoAdmin>} />
        <Route path="controle-ambiental" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="controle-ambiental"><AvisoSomenteLeitura usuario={sessao?.usuario}><ControleAmbientalView /></AvisoSomenteLeitura></RestritoAdmin>} />
        <Route path="controle-combustivel" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="controle-combustivel"><AvisoSomenteLeitura usuario={sessao?.usuario}><ControleCombustivelView /></AvisoSomenteLeitura></RestritoAdmin>} />
        <Route path="ecogestao" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="ecogestao"><AvisoSomenteLeitura usuario={sessao?.usuario}><EcoGestaoView /></AvisoSomenteLeitura></RestritoAdmin>} />
        <Route path="ecogestao/residuos" element={<Navigate to="/ecogestao?aba=residuos" replace />} />
        <Route path="residuos" element={<Navigate to="/ecogestao?aba=residuos" replace />} />
        <Route path="ecogestao/agua" element={<Navigate to="/ecogestao?aba=agua" replace />} />
        <Route path="agua" element={<Navigate to="/ecogestao?aba=agua" replace />} />
        <Route path="ecogestao/atos" element={<Navigate to="/ecogestao?aba=atos" replace />} />
        <Route path="atos" element={<Navigate to="/ecogestao?aba=atos" replace />} />
        <Route path="licencas" element={<Navigate to="/ecogestao?aba=atos" replace />} />
        <Route path="ecogestao/quimicos" element={<Navigate to="/ecogestao?aba=quimicos" replace />} />
        <Route path="quimicos" element={<Navigate to="/ecogestao?aba=quimicos" replace />} />
        <Route path="produtos-quimicos" element={<Navigate to="/ecogestao?aba=quimicos" replace />} />
        <Route path="usuarios" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="usuarios"><UsuariosView sessao={sessao} /></RestritoAdmin>} />
        <Route path="perfil" element={<RestritoAdmin operacional={operacional} usuario={sessao?.usuario} modulo="perfil"><PerfilView sessao={sessao} /></RestritoAdmin>} />
      </Route>
    </Routes>
  );
}
