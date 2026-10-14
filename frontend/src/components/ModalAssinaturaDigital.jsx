import { useEffect, useRef, useState } from "react";
import { PenTool, Eraser, Check, Loader2, CheckCircle2, RotateCcw } from "lucide-react";
import Modal from "./Modal.jsx";

export default function ModalAssinaturaDigital({
  open,
  onClose,
  onConfirmar,
  etapa,
  rotuloEtapa = "Etapa",
  usuario,
  salvando = false,
}) {
  const temAssinaturaCadastrada = !!usuario?.assinatura_url;
  const [tela, setTela] = useState("escolha");
  const [salvarNoPerfil, setSalvarNoPerfil] = useState(false);
  const canvasRef = useRef(null);
  const [desenhando, setDesenhando] = useState(false);
  const [temTracos, setTemTracos] = useState(false);
  const ultPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!open) return;
    // Sempre apresenta a dupla opção: cadastrada (com preview) x desenhar nova
    setTela("escolha");
    setSalvarNoPerfil(false);
    setTemTracos(false);
  }, [open]);

  useEffect(() => {
    if (!open || tela !== "canvas") return;
    const id = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width || 560;
      const h = rect.height || 200;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#0f172a";
      setTemTracos(false);
    }, 80);
    return () => clearTimeout(id);
  }, [open, tela]);

  const obterCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const iniciarDesenho = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const pos = obterCoords(e);
    ultPos.current = pos;
    setDesenhando(true);
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.25, 0, Math.PI * 2);
    ctx.fillStyle = "#0f172a";
    ctx.fill();
    setTemTracos(true);
  };

  const desenhar = (e) => {
    if (!desenhando) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pos = obterCoords(e);
    ctx.beginPath();
    ctx.moveTo(ultPos.current.x, ultPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ultPos.current = pos;
    setTemTracos(true);
  };

  const pararDesenho = (e) => {
    if (!desenhando) return;
    e.preventDefault();
    setDesenhando(false);
  };

  const limparCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setTemTracos(false);
  };

  const confirmarCadastrada = () => onConfirmar({ modo: "cadastrada" });

  const confirmarCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !temTracos) return;
    onConfirmar({ modo: "canvas", dataUrl: canvas.toDataURL("image/png"), salvarNoPerfil });
  };

  const COR_ETAPA = {
    OPERADOR:   { bg: "bg-amber-50",  text: "text-amber-800",  ring: "ring-amber-300",  dot: "bg-amber-400"  },
    TRANSPORTE: { bg: "bg-red-50",    text: "text-red-800",    ring: "ring-red-300",    dot: "bg-red-500"    },
    PLANEJADOR: { bg: "bg-green-50",  text: "text-green-800",  ring: "ring-green-300",  dot: "bg-green-500"  },
  };
  const cor = COR_ETAPA[etapa] || COR_ETAPA.OPERADOR;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assinar — ${rotuloEtapa}`}
      subtitle={`${usuario?.nome || ""}${usuario?.matricula ? ` • Matr. ${usuario.matricula}` : ""}`}
      size="md"
      footer={
        tela === "escolha" ? (
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
        ) : tela === "cadastrada" ? (
          <div className="flex items-center gap-2 w-full justify-end">
            <button onClick={() => setTela("escolha")} disabled={salvando} className="btn-secondary">Voltar</button>
            <button onClick={confirmarCadastrada} disabled={salvando} className="btn-primary">
              {salvando ? <><Loader2 size={14} className="animate-spin" /> Assinando...</> : <><Check size={14} /> Confirmar Assinatura</>}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            <button onClick={limparCanvas} disabled={!temTracos || salvando} className="btn-secondary !py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-40">
              <Eraser size={14} /> Limpar
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => setTela("escolha")} disabled={salvando} className="btn-secondary !py-2 text-xs">Voltar</button>
              <button onClick={confirmarCanvas} disabled={!temTracos || salvando} className="btn-primary !py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                {salvando ? <><Loader2 size={14} className="animate-spin" /> Assinando...</> : <><Check size={14} /> Confirmar Assinatura</>}
              </button>
            </div>
          </div>
        )
      }
    >
      <div className="space-y-4">
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold ring-1 ring-inset ${cor.bg} ${cor.text} ${cor.ring}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cor.dot}`} />
          {rotuloEtapa}
        </div>

        {tela === "escolha" && (
          <div className="space-y-3">
            <p className="text-xs text-omega-500">Escolha como deseja assinar este relatório:</p>
            {/* Opção 1 — Usar Assinatura Cadastrada (com preview) */}
            <button
              type="button"
              onClick={() => temAssinaturaCadastrada && setTela("cadastrada")}
              disabled={!temAssinaturaCadastrada}
              className={`w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left group ${
                temAssinaturaCadastrada
                  ? 'border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50 hover:border-emerald-400'
                  : 'border-omega-100 bg-omega-50/40 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-600 shrink-0">
                <CheckCircle2 size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-extrabold text-omega-900">1. Usar Assinatura Cadastrada</div>
                <div className="text-xs text-omega-500 mt-0.5">
                  {temAssinaturaCadastrada
                    ? 'Assinatura digital registrada no seu perfil. Rápido e seguro.'
                    : 'Nenhuma assinatura salva no perfil — desenhe uma nova abaixo.'}
                </div>
                {temAssinaturaCadastrada ? (
                  <div className="mt-2 rounded-lg bg-white border border-emerald-200 p-1.5 inline-block">
                    <img src={usuario?.assinatura_url} alt="Assinatura cadastrada" className="max-h-10 max-w-[140px] object-contain" />
                  </div>
                ) : null}
              </div>
            </button>
            {/* Opção 2 — Desenhar Nova Assinatura (canvas interativo) */}
            <button type="button" onClick={() => setTela("canvas")} className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-omega-200 bg-omega-50/40 hover:bg-omega-50 hover:border-omega-accent transition-all text-left group">
              <div className="w-10 h-10 rounded-xl bg-omega-accent/10 flex items-center justify-center text-omega-accent shrink-0">
                <PenTool size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-extrabold text-omega-900">2. Desenhar Nova Assinatura</div>
                <div className="text-xs text-omega-500 mt-0.5">Desenhe sua assinatura agora usando o mouse, dedo ou caneta.</div>
              </div>
            </button>
          </div>
        )}

        {tela === "cadastrada" && (
          <div className="space-y-3">
            <p className="text-xs text-omega-500">Sua assinatura digital será registrada neste relatório:</p>
            <div className="rounded-2xl border border-emerald-200 bg-white shadow-sm p-5 flex flex-col items-center gap-3">
              <img src={usuario?.assinatura_url} alt={`Assinatura de ${usuario?.nome}`} className="max-h-24 max-w-[260px] object-contain" />
              <div className="text-center">
                <div className="text-sm font-bold text-omega-900">{usuario?.nome}</div>
                {usuario?.matricula && <div className="text-xs text-omega-400 font-mono">Matr. {usuario.matricula}</div>}
                <div className="text-[11px] text-omega-400 mt-0.5">{new Date().toLocaleString("pt-BR")}</div>
              </div>
            </div>
            <button type="button" onClick={() => setTela("canvas")} className="text-xs text-omega-accent hover:underline inline-flex items-center gap-1">
              <RotateCcw size={11} /> Prefiro assinar manualmente
            </button>
          </div>
        )}

        {tela === "canvas" && (
          <div className="space-y-3">
            <p className="text-xs text-omega-500">Desenhe sua assinatura no quadro abaixo:</p>
            <div className="relative rounded-2xl border-2 border-dashed border-omega-200 bg-white shadow-inner p-1 overflow-hidden select-none">
              <canvas
                ref={canvasRef}
                onPointerDown={iniciarDesenho}
                onPointerMove={desenhar}
                onPointerUp={pararDesenho}
                onPointerCancel={pararDesenho}
                className="w-full h-48 cursor-crosshair touch-none block"
                style={{ touchAction: "none" }}
              />
              <div className="pointer-events-none absolute bottom-9 left-8 right-8 flex items-center justify-between border-b border-omega-200/80 pb-1 text-[11px] font-mono text-omega-400">
                <span className="flex items-center gap-1"><PenTool size={11} /> Assine sobre a linha</span>
                <span className="text-[10px] uppercase tracking-wider text-omega-300">OmegaTrack</span>
              </div>
              {!temTracos && !desenhando && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-omega-300 gap-1.5">
                  <PenTool size={26} className="opacity-40" />
                  <span className="text-xs font-semibold opacity-60">Toque ou clique para assinar</span>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none group">
              <input type="checkbox" checked={salvarNoPerfil} onChange={(e) => setSalvarNoPerfil(e.target.checked)} className="w-4 h-4 rounded accent-omega-accent" />
              <span className="text-xs text-omega-600 group-hover:text-omega-900 transition-colors">
                Salvar esta assinatura no meu perfil para usos futuros
              </span>
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
}
