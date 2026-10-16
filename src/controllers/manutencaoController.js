import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import {
  parseKm,
  calcularStatusManutencao,
  mediaKmDia,
  dataPrevistaPreventiva,
  mapaUltimasPreventivas,
  JANELA_MEDIA_DIAS,
  JANELA_LEITURA_DIAS,
} from '../services/manutencaoService.js';

// ============================================================================
// FASE 3 — GET /api/manutencao/projecao-frota
// Consolidado preditivo da frota ativa: última leitura (janela de 60 dias),
// média diária (30 dias, dias úteis seg–sáb) e projeção da preventiva
// (dias corridos a partir de hoje).
// ============================================================================
export const projecaoFrota = asyncHandler(async (req, res) => {
  const veiculos = await prisma.mobDesmob.findMany({
    where: { status: { not: 'Desmobilizado' } },
    orderBy: { tag: 'asc' },
    select: { tag: true, placa: true, modelo: true, status: true, km_limite_preventiva: true, km_ultima_preventiva: true },
  });
  if (veiculos.length === 0) {
    return res.json({ data: [], meta: { gerado_em: new Date().toISOString(), janela_dias: JANELA_MEDIA_DIAS, total: 0 } });
  }

  const tags = veiculos.map((v) => v.tag);
  const tagsUpper = tags.map((t) => String(t).toUpperCase());
  const desdeLeitura = new Date();
  desdeLeitura.setHours(0, 0, 0, 0);
  desdeLeitura.setDate(desdeLeitura.getDate() - (JANELA_LEITURA_DIAS - 1));
  const desdeMedia = new Date();
  desdeMedia.setHours(0, 0, 0, 0);
  desdeMedia.setDate(desdeMedia.getDate() - (JANELA_MEDIA_DIAS - 1));

  // Tabela dinâmica de parâmetros (1 consulta; precedência por veículo em JS).
  const parametros = await prisma.parametroPreventiva.findMany();
  const porCategoria = new Map();
  for (const p of parametros) {
    porCategoria.set(`${p.categoria}||${p.contrato || ''}`, p);
  }
  const limiteDe = (modelo, contrato, limiteVeiculo) => {
    const cat = String(modelo || '').trim().toUpperCase();
    const cont = String(contrato || '').trim();
    if (cat) {
      const exato = cont ? porCategoria.get(`${cat}||${cont}`) : null;
      if (exato) return { km_limite: exato.km_limite_preventiva, origem_limite: 'categoria+contrato' };
      const global = porCategoria.get(`${cat}||`);
      if (global) return { km_limite: global.km_limite_preventiva, origem_limite: 'categoria' };
    }
    const lv = Number(limiteVeiculo);
    if (Number.isFinite(lv) && lv > 0) return { km_limite: Math.trunc(lv), origem_limite: 'veiculo' };
    return { km_limite: 10000, origem_limite: 'padrao' };
  };
  const partes = await prisma.parteDiaria.findMany({
    where: { tag: { in: [...tags, ...tagsUpper] }, data: { gte: desdeLeitura }, km_final: { not: null } },
    orderBy: [{ data: 'asc' }, { created_at: 'asc' }],
    select: { tag: true, data: true, km_final: true },
  });
  const porTag = new Map();
  for (const p of partes) {
    const km = parseKm(p.km_final);
    if (km === null) continue;
    const chave = String(p.tag).toUpperCase();
    if (!porTag.has(chave)) porTag.set(chave, []);
    porTag.get(chave).push({ data: p.data, km });
  }

  // Âncoras de preventiva da frota (última parte preventiva por TAG).
  const preventivas = await mapaUltimasPreventivas(tagsUpper);

  const linhas = veiculos.map((v) => {
    const chave = String(v.tag).toUpperCase();
    const leituras = porTag.get(chave) || [];
    const kmAtual = leituras.length > 0 ? leituras[leituras.length - 1].km : null;
    const leiturasMedia = leituras.filter((l) => new Date(l.data) >= desdeMedia);
    const media = mediaKmDia(leiturasMedia);
    const resolvido = limiteDe(v.modelo, v.contrato, v.km_limite_preventiva);
    // Âncora: parte preventiva > coluna manual > 0.
    const prev = preventivas.get(chave);
    const manual = parseKm(v.km_ultima_preventiva);
    const ancora = prev
      ? { km: prev.km_ultima_preventiva, origem: 'parte_preventiva' }
      : manual !== null
        ? { km: manual, origem: 'registro_manual' }
        : { km: 0, origem: 'zero' };
    const diag = calcularStatusManutencao({
      kmAtual,
      kmUltimaPreventiva: ancora.km,
      kmLimite: resolvido.km_limite,
    });
    const restantes = diag.km_restantes_para_preventiva;
    let diasRestantes = null;
    if (restantes !== null && restantes !== undefined) {
      if (restantes <= 0) {
        diasRestantes = 0;
      } else if (media !== null && media > 0) {
        diasRestantes = Math.ceil(restantes / media);
      }
    }
    return {
      tag: v.tag,
      placa: v.placa,
      modelo: v.modelo,
      status: v.status,
      km_atual: kmAtual,
      km_ultima_preventiva: ancora.km,
      origem_preventiva: ancora.origem,
      km_limite_preventiva: diag.km_limite_preventiva,
      origem_limite: resolvido.origem_limite,
      km_rodados_desde_preventiva: diag.km_rodados_desde_preventiva,
      km_restantes: restantes,
      media_km_dia: media,
      dias_restantes_estimados: diasRestantes,
      data_prevista_preventiva: diasRestantes === null ? null : dataPrevistaPreventiva(diasRestantes),
      status_alerta: diag.status_alerta,
      sem_registro_preventiva: ancora.origem === 'zero',
      leituras_na_janela: leiturasMedia.length,
    };
  });

  // Ordena: vencidos, depois menor prazo; sem dados por último.
  const peso = (l) => (l.dias_restantes_estimados === null || l.dias_restantes_estimados === undefined ? Number.MAX_SAFE_INTEGER : l.dias_restantes_estimados);
  linhas.sort((a, b) => peso(a) - peso(b));

  res.json({
    data: linhas,
    meta: { gerado_em: new Date().toISOString(), janela_dias: JANELA_MEDIA_DIAS, total: linhas.length },
  });
});
