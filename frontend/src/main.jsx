import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import './theme.css';
import { instalarModoOffline } from './offline/index.js';
import { instalarAutenticacaoApi } from './utils/sessao.js';

// Antes do primeiro render: o fetch anexa o token da sessao e, por cima, passa
// pelo cache/fila offline. A ordem importa (autenticacao primeiro).
instalarAutenticacaoApi();
instalarModoOffline();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
