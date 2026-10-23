import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, AlertTriangle, KeyRound, ArrowRight, ArrowLeft } from 'lucide-react';
import { fazerLogin, verificarMatricula, rotaInicialPorSetor } from '../utils/sessao.js';

// Login dinâmico em 2 etapas:
//  1. Só matrícula + "Avançar" -> checa o perfil no banco.
//  2a. OPERACIONAL -> entra direto só com a matrícula.
//  2b. ADMINISTRADOR -> revela o campo de senha com animação ("Entrar").
export default function LoginView({ onLogin }) {
  const navigate = useNavigate();
  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [etapa, setEtapa] = useState('matricula'); // 'matricula' | 'senha'
  const [perfil, setPerfil] = useState(null); // { nome, tipo } da etapa 1
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [mostrarAjuda, setMostrarAjuda] = useState(false);

  const concluirLogin = (data) => {
    onLogin?.({ token: data.token, usuario: data.usuario });
    navigate(rotaInicialPorSetor(data.usuario), { replace: true });
  };

  // Etapa 1: avançar com a matrícula.
  const avancar = async (e) => {
    e?.preventDefault();
    if (!matricula.trim()) {
      setErro('Informe a matrícula.');
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const info = await verificarMatricula(matricula.trim());
      if (!info.exigeSenha) {
        // Operacional: autentica direto só com a matrícula.
        const data = await fazerLogin(matricula.trim());
        concluirLogin(data);
        return;
      }
      // ADM/Gestor/Master: revela a senha.
      setPerfil(info);
      setEtapa('senha');
    } catch (err) {
      setErro(err.message || 'Matrícula não cadastrada no sistema.');
    } finally {
      setCarregando(false);
    }
  };

  // Etapa 2 (ADM): entrar com matrícula + senha.
  const entrar = async (e) => {
    e?.preventDefault();
    if (!senha) {
      setErro('Informe a senha.');
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const data = await fazerLogin(matricula.trim(), senha);
      concluirLogin(data);
    } catch (err) {
      setErro(err.message || 'Falha no login.');
    } finally {
      setCarregando(false);
    }
  };

  const trocarMatricula = () => {
    setEtapa('matricula');
    setPerfil(null);
    setSenha('');
    setMostrar(false);
    setErro(null);
  };

  return (
    <div className="min-h-screen bg-omega-950 flex items-center justify-center p-4 relative overflow-hidden">
      <style>{`
        @keyframes omega-fade-slide-in {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .omega-senha-reveal {
          animation: omega-fade-slide-in 0.25s ease-out;
        }
      `}</style>
      <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-violet-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-omega-accent/20 blur-3xl" />

      <div className="relative w-full max-w-sm rounded-2xl bg-white/[0.04] border border-white/10 shadow-2xl p-7 backdrop-blur">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/95 border border-white/20 p-1 flex items-center justify-center shadow-xl shadow-black/40">
            <img
              src="/logo/logo-redonda.png"
              alt="Omega Serviços e Montagens Industriais"
              className="w-full h-full object-contain drop-shadow-sm"
              onError={(e) => {
                if (!e.target.dataset.fb) {
                  e.target.dataset.fb = '1';
                  e.target.src = '/logo/0.png';
                }
              }}
            />
          </div>
          <h1 className="mt-3 text-xl font-extrabold text-white tracking-tight">Omega Track</h1>
          <p className="mt-0.5 text-xs text-white/60 font-medium">Omega Serviços e Montagens Industriais</p>
          <div className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 border border-white/10 text-[10px] font-semibold text-white/80">
            <span className="w-1.5 h-1.5 rounded-full bg-status-verde" />
            Gestão de Frotas e Operações
          </div>
        </div>

        <form onSubmit={etapa === 'senha' ? entrar : avancar} className="mt-6 space-y-3.5">
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
              disabled={etapa === 'senha'}
              autoComplete="username"
              autoFocus={etapa === 'matricula'}
              placeholder="Ex: 23574"
              className="block w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-white/30 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-70"
            />
          </div>

          {etapa === 'senha' && (
            <div className="omega-senha-reveal space-y-3.5">
              <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                <span className="text-xs text-white/70">
                  Olá, <b className="text-white">{perfil?.nome || 'colaborador'}</b>
                </span>
                <button
                  type="button"
                  onClick={trocarMatricula}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-300 hover:text-violet-100 transition-colors"
                  title="Voltar e digitar outra matrícula"
                >
                  <ArrowLeft size={12} /> Trocar matrícula
                </button>
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
                    autoFocus
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
            </div>
          )}

          <button
            type="submit"
            disabled={carregando}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-omega-accent px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-violet-900/40 transition-all hover:brightness-110 hover:shadow-violet-800/50 disabled:opacity-60"
          >
            {etapa === 'senha' ? (
              <><LogIn size={16} /> {carregando ? 'Entrando...' : 'Entrar'}</>
            ) : (
              <><ArrowRight size={16} /> {carregando ? 'Verificando...' : 'Avançar'}</>
            )}
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
