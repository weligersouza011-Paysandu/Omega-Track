// ============================================================================
// src/config/cloudinary.js — Serviço centralizado de mídia (Cloudinary)
// Regra de ouro: NENHUM binário vai para o Neon. O backend recebe o arquivo,
// sobe para o Cloudinary e persiste no banco SOMENTE a `secure_url`.
// Pastas na nuvem (escalável por módulo):
//   mobilizacao   -> omegatrack/mobilizacao   (fotos de veículos)
//   partes-diarias-> omegatrack/partes-diarias (futuras evidências)
//   documentos    -> omegatrack/documentos    (anexos do Farol)
// ============================================================================
import 'dotenv/config';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

export const cloudinaryConfigured = Boolean(
  CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET
);

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: true,
});

if (!cloudinaryConfigured) {
  console.warn('[Cloudinary] Variaveis CLOUDINARY_* ausentes no .env — uploads retornarao 503.');
}

// Pastas oficiais por módulo (chave pública usada em ?pasta=)
export const PASTAS = {
  mobilizacao: 'omegatrack/mobilizacao',
  'partes-diarias': 'omegatrack/partes-diarias',
  documentos: 'omegatrack/documentos',
  assinaturas: 'omegatrack/assinaturas',
};

export const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const TIPOS_DOCUMENTO = [...TIPOS_IMAGEM, 'application/pdf'];

export const LIMITE_ARQUIVO_BYTES = 5 * 1024 * 1024; // 5 MB

function imageFileFilter(tiposPermitidos = TIPOS_IMAGEM) {
  return function fileFilter(req, file, cb) {
    if (tiposPermitidos.includes(file.mimetype)) return cb(null, true);
    const err = new Error(
      tiposPermitidos.includes('application/pdf')
        ? 'Tipo de arquivo invalido. Envie um PDF ou imagem (JPEG, PNG, WEBP ou HEIC).'
        : 'Tipo de arquivo invalido. Envie uma imagem (JPEG, PNG, WEBP ou HEIC).'
    );
    err.statusCode = 400;
    cb(err);
  };
}

function nomeSeguro(originalname = 'arquivo') {
  return originalname
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[^\w-]+/g, '_')
    .slice(0, 60);
}

// Storage do Multer que já entrega o arquivo direto na pasta da nuvem,
// otimizado (limite 1600px, qualidade/formato automáticos) e convertido p/ webp.
// PDFs (pasta `documentos`) sobem como `raw`, sem conversão.
export function storageParaPasta(pasta = 'mobilizacao') {
  const folder = PASTAS[pasta] || PASTAS.mobilizacao;
  return new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      if (file.mimetype === 'application/pdf') {
        return {
          folder,
          resource_type: 'raw',
          public_id: `${Date.now()}-${nomeSeguro(file.originalname)}`,
        };
      }
      return {
        folder,
        resource_type: 'image',
        format: 'webp',
        public_id: `${Date.now()}-${nomeSeguro(file.originalname)}`,
        transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
      };
    },
  });
}

// Middleware pronto: campo `arquivo` (single). A URL pública sai em `req.file.path`.
// A pasta `documentos` aceita também PDF (anexos de documentação).
export function uploadMiddleware(pasta = 'mobilizacao') {
  const tipos = pasta === 'documentos' ? TIPOS_DOCUMENTO : TIPOS_IMAGEM;
  return multer({
    storage: storageParaPasta(pasta),
    fileFilter: imageFileFilter(tipos),
    limits: { fileSize: LIMITE_ARQUIVO_BYTES, files: 1 },
  }).single('arquivo');
}

// ============================================================================
// Regra de ouro: o Neon guarda SOMENTE a URL (string curta http/https).
// Rejeita base64/data-URI ou qualquer conteúdo binário embutido no JSON.
// Use nos controllers antes de persistir foto_veiculo / anexo_url / evidencia_url.
// ============================================================================
export function validarUrlMidia(url, nomeCampo = 'arquivo') {
  if (url === undefined || url === null || url === '') return;
  if (typeof url !== 'string') {
    const err = new Error(
      `Campo \`${nomeCampo}\` invalido: envie apenas a URL (secure_url) retornada pelo upload.`
    );
    err.statusCode = 400;
    throw err;
  }
  const valor = url.trim();
  if (valor.startsWith('data:') || valor.startsWith('blob:')) {
    const err = new Error(
      `Campo \`${nomeCampo}\` rejeitado: binario/base64 nao pode ser salvo no banco. ` +
        `Envie o arquivo via POST /api/upload (campo \`arquivo\`) e persista apenas a URL retornada.`
    );
    err.statusCode = 400;
    throw err;
  }
  if (valor.length > 2048) {
    const err = new Error(
      `Campo \`${nomeCampo}\` rejeitado: valor longo demais para uma URL. ` +
        `Faca o upload via POST /api/upload e salve somente a \`secure_url\`.`
    );
    err.statusCode = 400;
    throw err;
  }
  if (!/^https?:\/\/.+/i.test(valor)) {
    const err = new Error(
      `Campo \`${nomeCampo}\` invalido: esperado uma URL http(s) do Cloudinary.`
    );
    err.statusCode = 400;
    throw err;
  }
}

export { cloudinary };

// ============================================================================
// Purga de anexos: extrai o public_id da secure_url e destroi o asset
// (tenta `image`, cai para `raw`). Falha isolada nunca trava o chamador.
// ============================================================================
export function extrairPublicIdDaUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)$/i);
  if (!m) return null;
  return m[1].split(/[?#]/)[0].replace(/\.[a-z0-9]+$/i, '');
}

export async function excluirAssetCloudinary(url) {
  if (!cloudinaryConfigured) return { status: 'nao_configurado' };
  const publicId = extrairPublicIdDaUrl(url);
  if (!publicId) return { status: 'public_id_invalido' };
  try {
    const r = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    if (r.result === 'not found') {
      const r2 = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
      return { status: r2.result };
    }
    return { status: r.result };
  } catch (e) {
    console.error(`[Cloudinary] falha ao excluir ${publicId}:`, e.message);
    return { status: 'erro' };
  }
}

export async function uploadAssinaturaBase64(base64Data, identificador = 'usuario') {
  if (!cloudinaryConfigured) {
    throw new Error('Cloudinary não configurado. Verifique as variáveis de ambiente.');
  }
  if (!base64Data || typeof base64Data !== 'string') {
    throw new Error('Dado de assinatura base64 inválido.');
  }
  const folder = PASTAS.assinaturas || 'omegatrack/assinaturas';
  const cleanId = String(identificador || 'usuario').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const result = await cloudinary.uploader.upload(base64Data, {
    folder,
    resource_type: 'image',
    format: 'png',
    public_id: `${Date.now()}-assinatura-${cleanId}`,
    transformation: [{ width: 800, crop: 'limit', quality: 'auto' }],
  });
  return result.secure_url;
}

export default cloudinary;
