import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  CheckCircle2,
  Eraser,
  ImagePlus,
  Loader2,
  PenTool,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import Modal from "./Modal.jsx";
import { authHeaders, lerSessao } from "../utils/sessao.js";

const LIMITE_FOTO_BYTES = 10 * 1024 * 1024;

function lerArquivoComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem selecionada."));
    reader.readAsDataURL(file);
  });
}

function carregarImagem(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível processar a imagem. Use JPEG, PNG ou WEBP."));
    img.src = dataUrl;
  });
}

async function otimizarFoto(file) {
  if (!file) throw new Error("Selecione uma imagem da assinatura.");
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error("O arquivo selecionado não é uma imagem.");
  }
  if (file.size > LIMITE_FOTO_BYTES) {
    throw new Error("A foto deve ter no máximo 10 MB.");
  }

  const original = await lerArquivoComoDataUrl(file);
  const imagem = await carregarImagem(original);
  const maxLargura = 1400;
  const maxAltura = 900;
  const escala = Math.min(1, maxLargura / imagem.width, maxAltura / imagem.height);
  const largura = Math.max(1, Math.round(imagem.width * escala));
  const altura = Math.max(1, Math.round(imagem.height * escala));
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(imagem, 0, 0, largura, altura);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export default function ModalAssinaturaDigital({
  open,
  onClose,
  onConfirmar,
  etapa,
  rotuloEtapa = "Etapa",
  usuario,
  salvando = false,
  erro: erroExterno = null,
}) {
  const assinaturaInicial = usuario?.assinatura_padrao || usuario?.assinatura_url || null;
  const [tela, setTela] = useState("escolha");
  const [assinaturaPerfil, setAssinaturaPerfil] = useState(assinaturaInicial);
  const [carregandoPerfil, setCarregandoPerfil] = useState(false);
  const [erroPerfil, setErroPerfil] = useState(null);
  const [salvarNoPerfil, setSalvarNoPerfil] = useState(false);
  const canvasRef = useRef(null);
  const inputFotoRef = useRef(null);
  const [desenhando, setDesenhando] = useState(false);
  const [temTracos, setTemTracos] = useState(false);
  const [foto, setFoto] = useState(null);
  const [processandoFoto, setProcessandoFoto] = useState(false);
  const [erroFoto, setErroFoto] = useState(null);
  const ultPos = useRef({ x: 0, y: 0 });

  const temAssinaturaCadastrada = Boolean(assinaturaPerfil);

  useEffect(() => {
    if (!open) return undefined;
    setTela("escolha");
    setSalvarNoPerfil(false);
    setTemTracos(false);
    setFoto(null);
    setErroFoto(null);
    setErroPerfil(null);
    setAssinaturaPerfil(assinaturaInicial);

    const controller = new AbortController();
    (async () => {
      setCarregandoPerfil(true);
      try {
        const resp = await fetch("/api/usuarios/minha-assinatura", {
          headers: authHeaders(lerSessao()),
          signal: controller.signal,
        });
        const corpo = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(corpo?.message || `Falha ao carregar assinatura (${resp.status}).`);
        const salva = corpo?.data?.assinatura_padrao || corpo?.data?.assinatura_url || null;
        if (!controller.signal.aborted) setAssinaturaPerfil(salva);
      } catch (e) {
        if (e?.name !== "AbortError" && !controller.signal.aborted) {
          setErroPerfil("Não foi possível verificar a assinatura salva no perfil.");
        }
      } finally {
        if (!controller.signal.aborted) setCarregandoPerfil(false);
      }
    })();

    return () => controller.abort();
  }, [open, assinaturaInicial]);

  useEffect(() => {
    if (!open || tela !== "canvas") return undefined;
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

  const selecionarFoto = async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setProcessandoFoto(true);
    setErroFoto(null);
    try {
      const dataUrl = await otimizarFoto(arquivo);
      setFoto({ dataUrl, nome: arquivo.name || "Foto da assinatura" });
    } catch (erro) {
      setFoto(null);
      setErroFoto(erro?.message || "Não foi possível processar a foto.");
    } finally {
      setProcessandoFoto(false);
    }
  };

  const confirmarCadastrada = () => onConfirmar({ modo: "cadastrada", dataUrl: assinaturaPerfil });
  const confirmarCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !temTracos) return;
    onConfirmar({ modo: "canvas", dataUrl: canvas.toDataURL("image/png"), salvarNoPerfil });
  };
  const confirmarFoto = () => {
    if (!foto?.dataUrl) return;
    onConfirmar({ modo: "foto", dataUrl: foto.dataUrl, salvarNoPerfil });
  };

  const COR_ETAPA = {
    OPERADOR:   { bg: "bg-amber-50",  text: "text-amber-800",  ring: "ring-amber-300",  dot: "bg-amber-400"  },
    TRANSPORTE: { bg: "bg-red-50",    text: "text-red-800",    ring: "ring-red-300",    dot: "bg-red-500"    },
    PLANEJADOR: { bg: "bg-green-50",  text: "text-green-800",  ring: "ring-green-300",  dot: "bg-green-500"  },
  };
  const cor = COR_ETAPA[etapa] || COR_ETAPA.OPERADOR;

  const SalvarNoPerfil = () => (
    <label className="flex items-center gap-2 cursor-pointer select-none group">
      <input
        type="checkbox"
        checked={salvarNoPerfil}
        onChange={(e) => setSalvarNoPerfil(e.target.checked)}
        className="w-4 h-4 rounded accent-omega-accent"
      />
      <span className="text-xs text-omega-600 group-hover:text-omega-900 transition-colors">
        Salvar esta assinatura no meu perfil para usos futuros
      </span>
    </label>
  );

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
            <button onClick={confirmarCadastrada} disabled={salvando || !assinaturaPerfil} className="btn-primary">
              {salvando ? <><Loader2 size={14} className="animate-spin" /> Assinando...</> : <><Check size={14} /> Confirmar Assinatura</>}
            </button>
          </div>
        ) : tela === "canvas" ? (
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
        ) : (
          <div className="flex items-center justify-end gap-2 w-full">
            <button onClick={() => setTela("escolha")} disabled={salvando || processandoFoto} className="btn-secondary">Voltar</button>
            <button onClick={confirmarFoto} disabled={!foto?.dataUrl || processandoFoto || salvando} className="btn-primary">
              {salvando ? <><Loader2 size={14} className="animate-spin" /> Assinando...</> : <><Check size={14} /> Confirmar Assinatura</>}
            </button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold ring-1 ring-inset ${cor.bg} ${cor.text} ${cor.ring}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cor.dot}`} />
          {rotuloEtapa}
        </div>

        {(erroExterno || erroFoto) && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            {erroExterno || erroFoto}
          </div>
        )}

        {erroPerfil && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            {erroPerfil} Você ainda pode desenhar ou anexar uma nova assinatura.
          </div>
        )}

        {tela === "escolha" && (
          <div className="space-y-3">
            <p className="text-xs text-omega-500">Escolha como deseja assinar este relatório:</p>

            <button
              type="button"
              onClick={() => temAssinaturaCadastrada && setTela("cadastrada")}
              disabled={carregandoPerfil || !temAssinaturaCadastrada}
              className={`w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left group ${
                temAssinaturaCadastrada
                  ? "border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50 hover:border-emerald-400"
                  : "border-omega-100 bg-omega-50/40 opacity-60 cursor-not-allowed"
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-600 shrink-0">
                {carregandoPerfil ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-extrabold text-omega-900">
                  {carregandoPerfil ? "Verificando assinatura do perfil..." : "1. Usar assinatura salva do perfil"}
                </div>
                <div className="text-xs text-omega-500 mt-0.5">
                  {carregandoPerfil
                    ? "Buscando a assinatura padrão cadastrada no seu usuário."
                    : temAssinaturaCadastrada
                      ? "Assinatura registrada no seu perfil. Rápido e seguro."
                      : "Nenhuma assinatura salva no perfil — desenhe ou anexe uma foto."}
                </div>
                {temAssinaturaCadastrada ? (
                  <div className="mt-2 rounded-lg bg-white border border-emerald-200 p-1.5 inline-block">
                    <img src={assinaturaPerfil} alt="Assinatura salva no perfil" className="max-h-10 max-w-[140px] object-contain" />
                  </div>
                ) : null}
              </div>
            </button>

            <button type="button" onClick={() => setTela("canvas")} className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-omega-200 bg-omega-50/40 hover:bg-omega-50 hover:border-omega-accent transition-all text-left group">
              <div className="w-10 h-10 rounded-xl bg-omega-accent/10 flex items-center justify-center text-omega-accent shrink-0">
                <PenTool size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-extrabold text-omega-900">2. Desenhar Nova Assinatura</div>
                <div className="text-xs text-omega-500 mt-0.5">Desenhe sua assinatura agora usando o mouse, dedo ou caneta.</div>
              </div>
            </button>

            <button type="button" onClick={() => setTela("foto")} className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-omega-200 bg-omega-50/40 hover:bg-omega-50 hover:border-omega-accent transition-all text-left group">
              <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-600 shrink-0">
                <Camera size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-extrabold text-omega-900">3. Anexar Foto da Assinatura</div>
                <div className="text-xs text-omega-500 mt-0.5">Envie uma foto ou imagem da sua assinatura em papel.</div>
              </div>
            </button>
          </div>
        )}

        {tela === "cadastrada" && (
          <div className="space-y-3">
            <p className="text-xs text-omega-500">Sua assinatura salva será registrada neste relatório:</p>
            <div className="rounded-2xl border border-emerald-200 bg-white shadow-sm p-5 flex flex-col items-center gap-3">
              <img src={assinaturaPerfil} alt={`Assinatura de ${usuario?.nome || "usuário"}`} className="max-h-24 max-w-[260px] object-contain" />
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
            <SalvarNoPerfil />
          </div>
        )}

        {tela === "foto" && (
          <div className="space-y-3">
            <p className="text-xs text-omega-500">Selecione ou fotografe sua assinatura. A imagem será otimizada antes do envio.</p>
            <input
              ref={inputFotoRef}
              id="assinatura-foto-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/*"
              onChange={selecionarFoto}
              className="sr-only"
              aria-label="Selecionar foto da assinatura"
            />

            {processandoFoto ? (
              <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-omega-200 bg-omega-50/50 text-omega-500">
                <Loader2 size={24} className="animate-spin text-omega-accent" />
                <span className="text-xs font-semibold">Otimizando imagem...</span>
              </div>
            ) : foto ? (
              <div className="rounded-2xl border border-sky-200 bg-white p-3 shadow-sm">
                <img src={foto.dataUrl} alt="Prévia da foto da assinatura" className="mx-auto max-h-52 w-auto max-w-full rounded-lg object-contain" />
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-omega-100 pt-2">
                  <span className="truncate text-[11px] text-omega-400">{foto.nome}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => inputFotoRef.current?.click()} className="btn-secondary !px-2 !py-1 text-[11px]">
                      <Upload size={12} /> Trocar
                    </button>
                    <button type="button" onClick={() => setFoto(null)} className="btn-secondary !px-2 !py-1 text-[11px] text-red-600">
                      <Trash2 size={12} /> Remover
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputFotoRef.current?.click()}
                className="flex min-h-44 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-omega-200 bg-omega-50/50 text-omega-500 transition-colors hover:border-omega-accent hover:bg-omega-50"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-600">
                  <ImagePlus size={24} />
                </span>
                <span className="text-sm font-bold text-omega-800">Escolher foto da assinatura</span>
                <span className="text-[11px] text-omega-400">JPEG, PNG ou WEBP • até 10 MB</span>
              </button>
            )}

            <SalvarNoPerfil />
          </div>
        )}
      </div>
    </Modal>
  );
}
