// Utilitários dos quadros de assinatura (canvas).
//
// Na tela, a tinta acompanha o tema para ter contraste com o fundo do quadro:
// clara no tema escuro e escura no tema claro. Na exportação a tinta é sempre
// normalizada para preto sobre fundo transparente, para que a imagem salva
// continue legível no PDF, na impressão e nos previews sobre fundo branco.

export const TINTA_EXPORTACAO = '#0f172a';
const TINTA_TEMA_CLARO = '#0f172a';
const TINTA_TEMA_ESCURO = '#f8fafc';

export function temaEscuroAtivo() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

export function corTintaTela() {
  return temaEscuroAtivo() ? TINTA_TEMA_ESCURO : TINTA_TEMA_CLARO;
}

// Gera o PNG da assinatura com todos os traços convertidos para preto,
// preservando o canal alfa (fundo transparente e bordas suavizadas).
export function exportarAssinaturaPng(canvas) {
  const saida = document.createElement('canvas');
  saida.width = canvas.width;
  saida.height = canvas.height;
  const ctx = saida.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = TINTA_EXPORTACAO;
  ctx.fillRect(0, 0, saida.width, saida.height);
  return saida.toDataURL('image/png');
}
