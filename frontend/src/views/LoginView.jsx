import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, AlertTriangle, KeyRound } from 'lucide-react';
import { fazerLogin, rotaInicialPorSetor } from '../utils/sessao.js';

export default function LoginView({ onLogin }) {
  const navigate = useNavigate();
  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState(null);
  const [mostrarAjuda, setMostrarAjuda] = useState(false);

  const entrar = async (e) => {
    e?.preventDefault();
    if (!matricula.trim() || !senha) {
      setErro('Informe matrícula e senha.');
      return;
    }
    setEntrando(true);
    setErro(null);
    try {
      const data = await fazerLogin(matricula.trim(), senha);
      onLogin?.({ token: data.token, usuario: data.usuario });
      navigate(rotaInicialPorSetor(data.usuario), { replace: true });
    } catch (err) {
      setErro(err.message || 'Falha no login.');
    } finally {
      setEntrando(false);
    }
  };

  return (
    <div className="min-h-screen bg-omega-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-violet-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-omega-accent/20 blur-3xl" />

      <div className="relative w-full max-w-sm rounded-2xl bg-white/[0.04] border border-white/10 shadow-2xl p-7 backdrop-blur">
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-omega-accent flex items-center justify-center font-extrabold text-white text-2xl shadow-lg shadow-violet-900/40">
            Ω
          </div>
          <h1 className="mt-3 text-xl font-extrabold text-white tracking-tight">Omega Track</h1>
          <p className="mt-0.5 text-xs text-white/50">Gestão de Frota & Manutenção</p>
        </div>

        <form onSubmit={entrar} className="mt-6 space-y-3.5">
          {erro && (
            <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-xs font-semibold text-red-300">
              <AlertTriangle size={14} className="shrink-0 mt-px" /> {erro}
            </div>
          )}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-white/50 mb-1.5">
              Matrícula
            </label>
            <input
              value={matricula}
              onChange={(e) => setMatricula(e.target.value)}
              autoComplete="username"
              placeholder="Ex: 23574"
              className="block w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-white/30 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-white/50 mb-1.5">
              Senha
            </label>
            <div className="relative">
              <input
                type={mostrar ? 'text' : 'password'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                className="block w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 pr-11 text-sm text-white placeholder-white/30 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
              <button
                type="button"
                onClick={() => setMostrar((v) => !v)}
                title={mostrar ? 'Ocultar senha' : 'Visualizar senha'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 p-1"
              >
                {mostrar ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={entrando}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-omega-accent px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-violet-900/40 transition-all hover:brightness-110 hover:shadow-violet-800/50 disabled:opacity-60"
          >
            <LogIn size={16} /> {entrando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => setMostrarAjuda((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 hover:text-white/90 transition-colors"
          >
            <KeyRound size={13} /> Esqueci minha senha
          </button>
          {mostrarAjuda && (
            <div className="mt-2.5 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-[11px] leading-relaxed text-white/60">
              Solicite a um <b className="text-white/90">administrador Master</b> a redefinição da sua
              senha em <b className="text-white/90">Gestão de Usuários → Editar</b>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
