// ============================================================================
// src/utils/senha.js — Hash scrypt (sem dependencias externas).
// Formato: `scrypt:<salt-hex>:<hash-hex>` (salt 16B, hash 64B).
// ============================================================================
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashSenha(senha) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(senha), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verificarSenha(senha, senhaHash) {
  if (!senha || !senhaHash || typeof senhaHash !== 'string') return false;
  const partes = senhaHash.split(':');
  if (partes.length !== 3 || partes[0] !== 'scrypt') return false;
  const [, salt, esperado] = partes;
  try {
    const obtido = scryptSync(String(senha), salt, 64);
    const ref = Buffer.from(esperado, 'hex');
    return obtido.length === ref.length && timingSafeEqual(obtido, ref);
  } catch {
    return false;
  }
}
