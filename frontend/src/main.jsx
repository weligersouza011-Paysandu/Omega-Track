import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import './theme.css';
import { instalarModoOffline } from './offline/index.js';

// Antes do primeiro render: todas as telas passam pelo fetch com cache/fila offline.
instalarModoOffline();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
