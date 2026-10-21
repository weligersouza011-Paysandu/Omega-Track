import prisma from '../config/database.js';
import {
  LIMITE_ARQUIVO_BYTES,
  uploadAssinaturaBase64,
  validarUrlMidia,
} from '../config/cloudinary.js';

const DATA_URL_IMAGEM = /^data:image\/(png|jpe?g|webp);base64,/i;
const TAMANHO_MAX_DATA_URL = Math.ceil((LIMITE_ARQUIVO_BYTES * 4) / 3) + 256;

function erroValidacao(message) {
  const erro = new Error(message);
  erro.statusCode = 400;
  return erro;
}

function validarDataUrlImagem(valor) {
  if (!DATA_URL_IMAGEM.test(valor)) {
    throw erroValidacao('Envie uma imagem PNG, JPEG ou WEBP válida em base64.');
  }
  if (valor.length > TAMANHO_MAX_DATA_URL) {
    throw erroValidacao('A imagem da assinatura deve ter no máximo 5 MB.');
  }
}

function valorRecebido(dados) {
  return dados?.assinatura_base64 || dados?.assinatura_padrao || dados?.assinatura_url || null;
}

export function respostaAssinatura(usuario) {
  const assinatura = usuario?.assinatura_padrao || usuario?.assinatura_url || null;
  return {
    assinatura_padrao: assinatura,
    assinatura_url: assinatura,
    tem_assinatura: Boolean(assinatura),
  };
}

export async function salvarAssinaturaPadrao(usuario, dados = {}) {
  const remover = dados?.remover === true;
  const valor = valorRecebido(dados);

  if (!remover && !valor) {
    throw erroValidacao('Envie `assinatura_base64` ou `assinatura_url`.');
  }
  if (!remover && typeof valor !== 'string') {
    throw erroValidacao('A assinatura deve ser enviada como texto.');
  }

  let urlFinal = null;
  if (!remover) {
    const texto = valor.trim();
    if (DATA_URL_IMAGEM.test(texto)) {
      validarDataUrlImagem(texto);
      urlFinal = await uploadAssinaturaBase64(texto, usuario.matricula);
    } else {
      validarUrlMidia(texto, 'assinatura_padrao');
      urlFinal = texto;
    }
  }

  return prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      assinatura_padrao: urlFinal,
      assinatura_url: urlFinal,
    },
  });
}
