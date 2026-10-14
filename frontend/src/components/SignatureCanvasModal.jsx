import { useEffect, useRef, useState } from 'react';
import { PenTool, Eraser, Check, X, Loader2 } from 'lucide-react';
import Modal from './Modal.jsx';

export default function SignatureCanvasModal({
  open,
  onClose,
  onSalvar,
  titulo = 'Desenhar / Adicionar Minha Assinatura',
  subtitulo = 'Desenhe sua assinatura abaixo usando o mouse, caneta ou o dedo.',
  salvando = false,
}) {
  const canvasRef = useRef(null);
  const [desenhando, setDesenhando] = useState(false);
  const [temTracos, setTemTracos] = useState(false);
  const ultPos = useRef({ x: 0, y: 0 });

  // Redimensiona o canvas com escala para alta densidade (Retina)
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 560;
    const h = rect.height || 220;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0f172a'; // Tinta azul-escura/preta profissional

    setTemTracos(false);
  }, [open]);

  const obterCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const iniciarDesenho = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignora caso não suporte pointerCapture
    }
    const pos = obterCoords(e);
    ultPos.current = pos;
    setDesenhando(true);

    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.25, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    setTemTracos(true);
  };

  const desenhar = (e) => {
    if (!desenhando) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
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

  const limpar = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setTemTracos(false);
  };

  const salvar = () => {
    const canvas = canvasRef.current;
    if (!canvas || !temTracos) return;
    // Exporta imagem em formato PNG transparente
    const dataUrl = canvas.toDataURL('image/png');
    onSalvar(dataUrl);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titulo}
      size="md"
      footer={
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            onClick={limpar}
            disabled={!temTracos || salvando}
            className="btn-secondary !py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <Eraser size={14} /> Limpar
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={salvando}
              className="btn-secondary !py-2 text-xs"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={!temTracos || salvando}
              className="btn-primary !py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {salvando ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Salvando...
                </>
              ) : (
                <>
                  <Check size={14} /> Salvar Assinatura
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-omega-500">{subtitulo}</p>

        <div className="relative rounded-2xl border-2 border-dashed border-omega-200 bg-white shadow-inner p-1 overflow-hidden select-none">
          <canvas
            ref={canvasRef}
            onPointerDown={iniciarDesenho}
            onPointerMove={desenhar}
            onPointerUp={pararDesenho}
            onPointerCancel={pararDesenho}
            className="w-full h-56 cursor-crosshair touch-none block"
            style={{ touchAction: 'none' }}
          />

          {/* Linha guia de assinatura */}
          <div className="pointer-events-none absolute bottom-9 left-8 right-8 flex items-center justify-between border-b border-omega-200/80 pb-1 text-[11px] font-mono text-omega-400">
            <span className="flex items-center gap-1">
              <PenTool size={11} /> Assine sobre a linha
            </span>
            <span className="text-[10px] uppercase tracking-wider text-omega-300">OmegaTrack ID</span>
          </div>

          {!temTracos && !desenhando && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-omega-300 gap-1.5">
              <PenTool size={26} className="opacity-40" />
              <span className="text-xs font-semibold opacity-60">Toque ou clique para assinar</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-omega-400 px-1">
          <span>* A assinatura será enviada com segurança para o Cloudinary e vinculada ao perfil.</span>
        </div>
      </div>
    </Modal>
  );
}
