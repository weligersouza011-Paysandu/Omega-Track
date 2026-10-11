import { Routes, Route } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import DashboardView from './views/DashboardView.jsx';
import MobDesmobView from './views/MobDesmobView.jsx';
import DashboardExecutivoView from './views/DashboardExecutivoView.jsx';
import FarolDocumentosView from './views/FarolDocumentosView.jsx';
import PendenciasParteDiariaView from './views/PendenciasParteDiariaView.jsx';
import TelemetriaView from './views/TelemetriaView.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<DashboardView />} />
        <Route path="executivo" element={<DashboardExecutivoView />} />
        <Route path="frota" element={<MobDesmobView />} />
        <Route path="farol-documentos" element={<FarolDocumentosView />} />
        <Route path="pendencias-parte-diaria" element={<PendenciasParteDiariaView />} />
        <Route path="telemetria" element={<TelemetriaView />} />
      </Route>
    </Routes>
  );
}
