// ============================================================================
// src/routes/uploadRoutes.js — Endpoint genérico de mídia
//   POST /api/upload?pasta=mobilizacao|partes-diarias|documentos
//   Campo multipart: `arquivo` (imagem, até 5 MB)
// Resposta 201: { data: { url, public_id, pasta } }
// O front-end persiste `url` (secure_url) no Neon (foto_veiculo, anexo_url,
// evidencia_url). Nenhum binário é gravado no banco.
// ============================================================================
import { Router } from 'express';
import { uploadMiddleware, PASTAS, cloudinaryConfigured, cloudinary } from '../config/cloudinary.js';

const router = Router();

router.post('/', (req, res, next) => {
  if (!cloudinaryConfigured) {
    return res.status(503).json({
      error: 'Servico indisponivel',
      message: 'Upload de midia nao configurado (variaveis CLOUDINARY_* ausentes).',
    });
  }

  const pasta = req.query.pasta || 'mobilizacao';
  if (!PASTAS[pasta]) {
    return res.status(400).json({
      error: 'Pasta invalida',
      message: `Use ?pasta= com um dos valores: ${Object.keys(PASTAS).join(', ')}.`,
    });
  }

  uploadMiddleware(pasta)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        err.message = 'Arquivo muito grande. Tamanho maximo: 5 MB.';
      }
      err.statusCode = err.statusCode || 400;
      return next(err);
    }
    if (!req.file) {
      return res.status(400).json({
        error: 'Arquivo ausente',
        message: 'Envie uma imagem no campo `arquivo` (multipart/form-data).',
      });
    }
    // CloudinaryStorage entrega a URL pública em `path` e o id em `filename`.
    return res.status(201).json({
      data: {
        url: req.file.path,
        public_id: req.file.filename,
        pasta,
      },
    });
  });
});

// DELETE /api/upload — remove um asset da nuvem pelo public_id.
// Body JSON: { "public_id": "omegatrack/mobilizacao/123-arquivo" }
// Uso: ao trocar/excluir foto da galeria, apague o arquivo antigo na nuvem
// e depois limpe a URL no Neon (PUT com foto_veiculo/anexo_url/evidencia_url = null).
router.delete('/', async (req, res, next) => {
  try {
    if (!cloudinaryConfigured) {
      return res.status(503).json({
        error: 'Servico indisponivel',
        message: 'Upload de midia nao configurado (variaveis CLOUDINARY_* ausentes).',
      });
    }
    const { public_id } = req.body || {};
    if (!public_id || typeof public_id !== 'string') {
      return res.status(400).json({
        error: 'public_id ausente',
        message: 'Informe o `public_id` do asset no corpo JSON.',
      });
    }
    const resultado = await cloudinary.uploader.destroy(public_id, { resource_type: 'image' });
    const final = resultado.result === 'not found'
      ? await cloudinary.uploader.destroy(public_id, { resource_type: 'raw' })
      : resultado;
    return res.json({ data: { public_id, resultado: final.result } });
  } catch (e) {
    return next(e);
  }
});

export default router;
