/**
 * RelatorioParteDiariaPreview.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Visualização/exportação do relatório "Parte Diária" — Omega Track.
 *
 * REGRA ZERO — ZERO ALUCINAÇÃO:
 * Este componente exibe EXCLUSIVAMENTE campos que existem no estado do
 * formulário original (ParteDiariaForm.jsx — `estadoVazio` / `montarPayload`).
 * Nenhuma seção, tabela, rótulo ou métrica foi inventada aqui.
 *
 * Campos reais mapeados (todos vindos de `relatorio`, que é `{...form,
 * id, numero_relatorio, assinaturas}`):
 *   Cabeçalho ......... numero_relatorio, data (+ dia da semana derivado),
 *                       status_operacional, numero_contrato, obra,
 *                       contratante, responsavel, planejador,
 *                       status do registro (derivado de status_relatorio +
 *                       assinaturas, mesma regra do formulário)
 *   Horário ........... horario_entrada, horario_saida, intervalo_entrada,
 *                       intervalo_saida (+ horas trabalhadas, cálculo direto
 *                       desses 4 inputs)
 *   Mão de obra ....... mao_obra[] { nome, matricula, funcao, observacao }
 *   Equipamentos ...... equipamentos[] { tag_patrimonio, descricao,
 *                       horimetro_inicial, horimetro_final, status }
 *                       (+ fallback real: `tag` / `veiculo.modelo` legado)
 *   Quilometragem ..... km_inicial, km_final
 *   Atividades ........ atividades[] { descricao, status }
 *   Ocorrências ....... ocorrencias[] { tipo, descricao }
 *   Checklist ......... checklist[] { item, foto_url } (2 itens fixos do
 *                       formulário; situação = foto anexada ou pendente)
 *   Fotos ............. fotos[] { url, legenda }
 *   Assinaturas ....... assinaturas[] { etapa, nome, matricula,
 *                       assinatura_dado|assinatura_url, assinado_em }
 *
 * Uso:
 *   <RelatorioParteDiariaPreview relatorio={obj} onFechar={() => {}} />
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef } from 'react';
import { Printer, X, Download, Loader2 } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const DIAS_PT = [
  'Domingo','Segunda-Feira','Terça-Feira','Quarta-Feira',
  'Quinta-Feira','Sexta-Feira','Sábado',
];

function diaSemanaDe(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return DIAS_PT[d.getDay()];
}

function formatarDataBR(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Horas trabalhadas = cálculo direto dos 4 inputs de horário do formulário.
function toMin(hhmm) {
  if (!hhmm || !String(hhmm).includes(':')) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minToHHMM(min) {
  if (min < 0) min = 0;
  const h = Math.floor(min / 60).toString().padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function calcHorasTrabalhadas(entrada, saida, intEntrada, intSaida) {
  const eMin = toMin(entrada);
  const sMin = toMin(saida);
  if (eMin === null || sMin === null) return '—';
  let total = sMin - eMin;
  if (total < 0) total += 24 * 60;
  const iE = toMin(intEntrada);
  const iS = toMin(intSaida);
  if (iE !== null && iS !== null) {
    let intervalo = iS - iE;
    if (intervalo < 0) intervalo += 24 * 60;
    total -= intervalo;
  }
  return minToHHMM(total);
}

// Status do registro — mesma regra do formulário (resolverStatusAprovacao).
function rotuloStatus(statusRelatorio, assinaturas = []) {
  const etapas = new Set((assinaturas || []).map((a) => String(a.etapa || '').toUpperCase()));
  if (etapas.has('PLANEJADOR') || statusRelatorio === 'APROVADO') return 'Aprovado';
  if (etapas.has('TRANSPORTE')) return 'Revisado pelo Transporte';
  if (etapas.has('OPERADOR')) return 'Finalizado pelo Operador';
  return 'Em Preenchimento';
}

function badgeStyle(statusKey) {
  const map = {
    'Aprovado':                  { bg: '#dcfce7', color: '#166534', border: '#86efac' },
    'Revisado pelo Transporte':  { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    'Finalizado pelo Operador':  { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
    'Em Preenchimento':          { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
  };
  return map[statusKey] || map['Em Preenchimento'];
}

function badgeAtivStyle(status) {
  const map = {
    'Pendente':     { bg: '#fee2e2', color: '#991b1b' },
    'Em Andamento': { bg: '#dbeafe', color: '#1e40af' },
    'Concluído':    { bg: '#dcfce7', color: '#166534' },
  };
  return map[status] || { bg: '#f1f5f9', color: '#475569' };
}

// ─── Micro-componentes de tabela ──────────────────────────────────────────────
// Células padronizadas p/ PDF legível: padding 6px 10px, bordas suaves,
// box-sizing global, table-layout fixo com larguras em % por coluna.
const BASE_CELL = {
  fontSize: 10,
  lineHeight: 1.45,
  padding: '6px 10px',
  border: '1px solid #e2e8f0',
  verticalAlign: 'middle',
  boxSizing: 'border-box',
  overflowWrap: 'break-word',
  wordWrap: 'break-word',
};

function ThCell({ children, style }) {
  return (
    <th style={{
      ...BASE_CELL,
      background: '#f1f5f9',
      fontWeight: 700,
      textAlign: 'left',
      whiteSpace: 'nowrap',
      ...style,
    }}>
      {children}
    </th>
  );
}

function TdCell({ children, style, colSpan }) {
  return (
    <td colSpan={colSpan} style={{ ...BASE_CELL, ...style }}>
      {children}
    </td>
  );
}

function SectionHeader({ title, count }) {
  return (
    <tr>
      <td colSpan={99} style={{
        ...BASE_CELL,
        background: '#f1f5f9',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        borderTop: '2px solid #94a3b8',
      }}>
        {title}{count !== undefined && count !== null ? ` (${count})` : ''}
      </td>
    </tr>
  );
}

function EmptyRow({ cols, text }) {
  return (
    <tr>
      <TdCell colSpan={cols} style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
        {text}
      </TdCell>
    </tr>
  );
}

// ─── Estilos compartilhados ───────────────────────────────────────────────────
const TAB = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
  fontSize: 10,
  boxSizing: 'border-box',
};
const OUTER = { border: '1px solid #e2e8f0', marginBottom: 8, boxSizing: 'border-box' };

// Larguras proporcionais explícitas (somam 100%) — evitam sobreposição.
const COLS_MAO_OBRA = ['24%', '46%', '30%'];          // Matrícula | Nome | Função
const COLS_EQUIP    = ['22%', '38%', '13%', '13%', '14%']; // TAG | Descrição | Hor.Ini | Hor.Fim | Status

function ColGroup({ widths }) {
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Componente principal
// ═════════════════════════════════════════════════════════════════════════════
export default function RelatorioParteDiariaPreview({ relatorio, onFechar }) {
  const printRef = useRef(null);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  if (!relatorio) return null;

  // Desestruturação estrita: SOMENTE chaves do formulário original.
  const {
    id,
    numero_relatorio,
    data,
    numero_contrato,
    obra,
    contratante,
    responsavel,
    planejador,
    horario_entrada,
    horario_saida,
    intervalo_entrada,
    intervalo_saida,
    status_relatorio = 'PREENCHENDO',
    status_operacional,
    status, // alias legado de status_operacional
    km_inicial,
    km_final,
    tag, // TAG legada (payload deriva do 1º equipamento)
    veiculo, // objeto legado { modelo } p/ descrição do fallback
    mao_obra      = [],
    equipamentos  = [],
    atividades    = [],
    ocorrencias   = [],
    checklist     = [],
    fotos         = [],
    assinaturas   = [],
  } = relatorio;

  // ── Download direto em PDF via html2pdf.js ──────────────────────────────────
  const baixarPdf = async () => {
    if (!printRef.current || gerandoPdf) return;
    setGerandoPdf(true);
    try {
      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = html2pdfModule.default || html2pdfModule;

      const tagPrincipal = tag || (equipamentos || [])[0]?.tag_patrimonio || 'RELATORIO';
      const tagLimpa = String(tagPrincipal).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const dataLimpa = data ? String(data).slice(0, 10).replace(/[^a-zA-Z0-9_-]/g, '_') : 'DATA';
      const nomeArquivo = `Parte_Diaria_${tagLimpa}_${dataLimpa}.pdf`;

      const opt = {
        margin: [6, 6, 8, 6],
        filename: nomeArquivo,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          logging: false,
          scrollY: 0,
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait',
        },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      };

      await html2pdf().set(opt).from(printRef.current).save();
    } catch (err) {
      console.error('Erro ao gerar PDF diretamente:', err);
      window.print();
    } finally {
      setGerandoPdf(false);
    }
  };

  // ── Dados derivados (todos calculados de campos reais do formulário) ───────
  const diaSemana      = diaSemanaDe(data);
  const dataFormatada  = formatarDataBR(data);
  const horasTrab      = calcHorasTrabalhadas(horario_entrada, horario_saida, intervalo_entrada, intervalo_saida);
  const statusLabel    = rotuloStatus(status_relatorio, assinaturas);
  const badgeSt        = badgeStyle(statusLabel);
  const statusOp       = status_operacional || status || '—';
  const numRelatorio   = numero_relatorio || id?.split('-')[0]?.toUpperCase() || '—';
  const entradaSaida   = horario_entrada && horario_saida ? `${horario_entrada} - ${horario_saida}` : horario_entrada || '—';
  const intervaloStr   = intervalo_entrada && intervalo_saida ? `${intervalo_entrada} - ${intervalo_saida}` : intervalo_entrada || '—';
  const kmIniStr       = km_inicial !== '' && km_inicial != null ? String(km_inicial) : '—';
  const kmFimStr       = km_final !== '' && km_final != null ? String(km_final) : '—';

  // Equipamentos: usa a lista real; fallback apenas p/ o `tag` legado do payload.
  const equipamentosView = equipamentos.length > 0
    ? equipamentos
    : (tag ? [{ tag_patrimonio: tag, descricao: veiculo?.modelo || '', horimetro_inicial: '', horimetro_final: '', status: '' }] : []);

  return (
    <>
      {/* ── CSS de impressão / PDF ─────────────────────────────────────── */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }

        #omega-pd-print {
          font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
          color: #1e293b;
          font-size: 10px;
          line-height: 1.45;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        #omega-pd-print *, #omega-pd-print *::before, #omega-pd-print *::after {
          box-sizing: border-box;
        }
        #omega-pd-print table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
        }
        #omega-pd-print th,
        #omega-pd-print td {
          padding: 6px 10px;
          border: 1px solid #e2e8f0;
          font-size: 10px;
          line-height: 1.45;
          overflow-wrap: break-word;
          word-wrap: break-word;
        }
        #omega-pd-print th {
          background: #f1f5f9;
          font-weight: 700;
          white-space: nowrap;
        }
        #omega-pd-print tr { break-inside: avoid; }

        @media print {
          body > * { visibility: hidden !important; }
          #omega-pd-print, #omega-pd-print * { visibility: visible !important; }
          #omega-pd-print {
            position: fixed !important;
            inset: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          #omega-pd-print table {
            width: 100% !important;
            table-layout: fixed !important;
          }
          #omega-pd-print th,
          #omega-pd-print td {
            padding: 6px 10px !important;
            border: 1px solid #e2e8f0 !important;
            font-size: 10px !important;
          }
          .omega-no-print { display: none !important; }
          @page {
            size: A4 portrait;
            margin: 8mm 8mm 10mm 8mm;
          }
        }
      `}</style>

      {/* ── Overlay backdrop ─────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(15,23,42,0.72)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        overflowY: 'auto', padding: '60px 0 40px',
        boxSizing: 'border-box',
      }}>

        {/* ── Barra de ações (não imprime) ──────────────────────────────── */}
        <div className="omega-no-print" style={{
          position: 'fixed', top: 14, right: 14, zIndex: 9200,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <button
            id="btn-baixar-pdf"
            onClick={baixarPdf}
            disabled={gerandoPdf}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: '#0284c7', color: '#fff',
              border: 'none', borderRadius: 9, padding: '9px 18px',
              fontWeight: 700, fontSize: 13, cursor: gerandoPdf ? 'not-allowed' : 'pointer',
              opacity: gerandoPdf ? 0.8 : 1,
              boxShadow: '0 4px 14px rgba(2,132,199,0.45)',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
            }}
            title="Baixar arquivo PDF diretamente"
          >
            {gerandoPdf ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Gerando PDF...
              </>
            ) : (
              <>
                <Download size={16} /> Baixar PDF
              </>
            )}
          </button>
          <button
            id="btn-imprimir-relatorio"
            onClick={() => window.print()}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: '#f97316', color: '#fff',
              border: 'none', borderRadius: 9, padding: '9px 18px',
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(249,115,22,0.45)',
              fontFamily: 'inherit',
            }}
            title="Abrir diálogo de impressão do navegador"
          >
            <Printer size={16} /> Imprimir
          </button>
          <button
            id="btn-fechar-relatorio"
            onClick={onFechar}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#1e293b', color: '#fff',
              border: 'none', borderRadius: 9, width: 40, height: 40,
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
            title="Fechar visualização"
          >
            <X size={18} />
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            ÁREA IMPRIMÍVEL — largura A4 (794 px @ 96 dpi)
            ══════════════════════════════════════════════════════════════════ */}
        <div
          id="omega-pd-print"
          ref={printRef}
          style={{
            width: 794, minHeight: 1123,
            background: '#fff',
            padding: '16px 20px',
            boxSizing: 'border-box',
            boxShadow: '0 12px 50px rgba(0,0,0,0.5)',
            borderRadius: 5,
            overflow: 'hidden',
          }}
        >

          {/* ── Linha topo ─────────────────────────────────────────── */}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 8, gap: 12,
            boxSizing: 'border-box',
          }}>
            <span style={{ fontSize: 10, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Parte Diária <strong>{dataFormatada}</strong> n° <strong>{numRelatorio}</strong>
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
              padding: '3px 14px', borderRadius: 5,
              background: badgeSt.bg, color: badgeSt.color,
              border: `1px solid ${badgeSt.border}`,
            }}>
              {statusLabel}
            </span>
          </div>

          {/* ── Bloco header: Logo + Metadados (só campos do formulário) ── */}
          <table style={{ ...TAB, ...OUTER }}>
            <colgroup>
              <col style={{ width: '54%' }} />
              <col style={{ width: '46%' }} />
            </colgroup>
            <tbody>
              <tr>
                {/* Coluna logo + título */}
                <td style={{
                  width: '54%', border: '1px solid #e2e8f0',
                  padding: '12px 16px', textAlign: 'center', verticalAlign: 'middle',
                  boxSizing: 'border-box',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <img
                      src="/logo/01.png"
                      alt="Omega Service"
                      style={{ height: 52, objectFit: 'contain' }}
                      onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                    />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: 1, color: '#1e293b' }}>
                        OMEGA
                      </div>
                      <div style={{ fontSize: 9, color: '#64748b', letterSpacing: 2, fontWeight: 600 }}>
                        SERVICE
                      </div>
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#1e293b', marginTop: 8 }}>
                    Parte Diária
                  </div>
                </td>

                {/* Coluna metadados — Relatório nº / Data / Dia / Status operacional / Contrato */}
                <td style={{ width: '46%', border: '1px solid #e2e8f0', padding: 0, verticalAlign: 'top', boxSizing: 'border-box' }}>
                  <table style={TAB}>
                    <colgroup>
                      <col style={{ width: '50%' }} />
                      <col style={{ width: '50%' }} />
                    </colgroup>
                    <tbody>
                      {[
                        ['Relatório nº',          numRelatorio],
                        ['Data',                  dataFormatada],
                        ['Dia da semana',         diaSemana],
                        ['Status operacional',    statusOp],
                        ['Contrato',              numero_contrato || '—'],
                      ].map(([label, value]) => (
                        <tr key={label}>
                          <ThCell style={{ width: '50%' }}>{label}</ThCell>
                          <TdCell style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</TdCell>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          {/* ── Dados da Obra / Local (só campos do formulário) ─────────── */}
          <table style={{ ...TAB, ...OUTER }}>
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '72%' }} />
            </colgroup>
            <tbody>
              <SectionHeader title="Obra / Local" />
              {[
                ['Obra',        obra || '—'],
                ['Contratante',  contratante || '—'],
                ['Responsável',  responsavel || '—'],
                ['Planejador',   planejador || '—'],
              ].map(([label, value]) => (
                <tr key={label}>
                  <ThCell style={{ width: '28%' }}>{label}</ThCell>
                  <TdCell style={{ whiteSpace: 'normal' }}>{value}</TdCell>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── Horário de Trabalho (4 inputs + horas calculadas) ───────── */}
          <table style={{ ...TAB, ...OUTER }}>
            <colgroup>
              <col style={{ width: '68%' }} />
              <col style={{ width: '32%' }} />
            </colgroup>
            <tbody>
              <SectionHeader title="Horário de trabalho" />
              <tr>
                {/* Esquerda: jornada + intervalo */}
                <td style={{ width: '68%', padding: 0, border: '1px solid #e2e8f0', verticalAlign: 'top', boxSizing: 'border-box' }}>
                  <table style={TAB}>
                    <colgroup>
                      <col style={{ width: '42%' }} />
                      <col style={{ width: '58%' }} />
                    </colgroup>
                    <tbody>
                      <tr>
                        <ThCell style={{ background: '#fafafa' }}>Entrada / Saída</ThCell>
                        <TdCell style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{entradaSaida}</TdCell>
                      </tr>
                      <tr>
                        <ThCell style={{ background: '#fafafa' }}>Intervalo</ThCell>
                        <TdCell style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{intervaloStr}</TdCell>
                      </tr>
                    </tbody>
                  </table>
                </td>
                {/* Direita: total em destaque — etiqueta separada do valor */}
                <td style={{
                  width: '32%', border: '1px solid #e2e8f0',
                  textAlign: 'center', verticalAlign: 'middle',
                  padding: '10px 12px', boxSizing: 'border-box',
                }}>
                  <div style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 6, minHeight: 62, boxSizing: 'border-box',
                  }}>
                    <div style={{
                      fontSize: 9, fontWeight: 700, color: '#64748b',
                      textTransform: 'uppercase', letterSpacing: 0.5,
                      lineHeight: 1.2, whiteSpace: 'nowrap',
                      margin: 0, padding: 0,
                    }}>
                      Horas trabalhadas
                    </div>
                    <div style={{
                      fontSize: 26, fontWeight: 900, color: '#1e293b',
                      fontVariantNumeric: 'tabular-nums', letterSpacing: 1,
                      lineHeight: 1, whiteSpace: 'nowrap',
                      marginTop: 4, paddingTop: 2,
                    }}>
                      {horasTrab}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* ── Mão de Obra (estrito: matricula / nome / funcao) ────────── */}
          <table style={{ ...TAB, ...OUTER }}>
            <ColGroup widths={COLS_MAO_OBRA} />
            <tbody>
              <SectionHeader title="Mão de obra" count={mao_obra.length} />
              <tr>
                <ThCell style={{ width: '24%', whiteSpace: 'nowrap' }}>Matrícula</ThCell>
                <ThCell style={{ width: '46%', whiteSpace: 'nowrap' }}>Nome</ThCell>
                <ThCell style={{ width: '30%', whiteSpace: 'nowrap' }}>Função</ThCell>
              </tr>
              {mao_obra.length === 0
                ? <EmptyRow cols={3} text="Nenhum colaborador lançado." />
                : mao_obra.map((m, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafcff' }}>
                      <TdCell style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                        {m.matricula || '—'}
                      </TdCell>
                      <TdCell style={{ whiteSpace: 'normal' }}>
                        {m.nome || '—'}
                        {m.observacao ? (
                          <span style={{ display: 'block', fontSize: 9, color: '#64748b', marginTop: 2 }}>
                            {m.observacao}
                          </span>
                        ) : null}
                      </TdCell>
                      <TdCell style={{ whiteSpace: 'normal' }}>{m.funcao || '—'}</TdCell>
                    </tr>
                  ))
              }
            </tbody>
          </table>

          {/* ── Equipamentos (estrito: props do objeto vinculado) ───────── */}
          <table style={{ ...TAB, ...OUTER }}>
            <ColGroup widths={COLS_EQUIP} />
            <tbody>
              <SectionHeader title="Equipamentos" count={equipamentosView.length} />
              <tr>
                <ThCell style={{ width: '22%', whiteSpace: 'nowrap' }}>TAG</ThCell>
                <ThCell style={{ width: '38%', whiteSpace: 'nowrap' }}>Descrição</ThCell>
                <ThCell style={{ width: '13%', whiteSpace: 'nowrap', textAlign: 'center' }}>Hor. Inicial</ThCell>
                <ThCell style={{ width: '13%', whiteSpace: 'nowrap', textAlign: 'center' }}>Hor. Final</ThCell>
                <ThCell style={{ width: '14%', whiteSpace: 'nowrap' }}>Status</ThCell>
              </tr>
              {equipamentosView.length === 0
                ? <EmptyRow cols={5} text="Nenhum veículo/equipamento lançado." />
                : equipamentosView.map((e, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafcff' }}>
                      <TdCell style={{ fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {e.tag_patrimonio || '—'}
                      </TdCell>
                      <TdCell style={{ whiteSpace: 'normal' }}>{e.descricao || '—'}</TdCell>
                      <TdCell style={{ textAlign: 'center', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{e.horimetro_inicial || '—'}</TdCell>
                      <TdCell style={{ textAlign: 'center', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{e.horimetro_final || '—'}</TdCell>
                      <TdCell style={{ whiteSpace: 'nowrap' }}>{e.status || '—'}</TdCell>
                    </tr>
                  ))
              }
            </tbody>
          </table>

          {/* ── Quilometragem (seção real do formulário) ────────────────── */}
          <table style={{ ...TAB, ...OUTER }}>
            <colgroup>
              <col style={{ width: '50%' }} />
              <col style={{ width: '50%' }} />
            </colgroup>
            <tbody>
              <SectionHeader title="Quilometragem" />
              <tr>
                <ThCell style={{ width: '50%' }}>KM Inicial</ThCell>
                <ThCell style={{ width: '50%' }}>KM Final</ThCell>
              </tr>
              <tr>
                <TdCell style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{kmIniStr}</TdCell>
                <TdCell style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{kmFimStr}</TdCell>
              </tr>
            </tbody>
          </table>

          {/* ── Atividades (estrito: descricao / status) ────────────────── */}
          <table style={{ ...TAB, ...OUTER }}>
            <colgroup>
              <col style={{ width: '82%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <tbody>
              <SectionHeader title="Atividades" count={atividades.length} />
              {atividades.length === 0
                ? <EmptyRow cols={2} text="Nenhuma atividade lançada." />
                : atividades.map((a, i) => {
                    const ast = badgeAtivStyle(a.status);
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafcff' }}>
                        <TdCell style={{ lineHeight: 1.55, whiteSpace: 'normal', width: '82%' }}>{a.descricao || '—'}</TdCell>
                        <TdCell style={{
                          width: '18%', textAlign: 'right', fontWeight: 700,
                          fontSize: 9, color: ast.color, background: ast.bg,
                          whiteSpace: 'nowrap', borderLeft: '2px solid #e2e8f0',
                        }}>
                          {a.status || '—'}
                        </TdCell>
                      </tr>
                    );
                  })
              }
            </tbody>
          </table>

          {/* ── Ocorrências (estrito: tipo / descricao) ─────────────────── */}
          <table style={{ ...TAB, ...OUTER }}>
            <colgroup>
              <col style={{ width: '25%' }} />
              <col style={{ width: '75%' }} />
            </colgroup>
            <tbody>
              <SectionHeader title="Ocorrências" count={ocorrencias.length} />
              {ocorrencias.length === 0
                ? <EmptyRow cols={2} text="Nenhuma ocorrência registrada." />
                : ocorrencias.map((o, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafcff' }}>
                      <TdCell style={{ width: '25%', whiteSpace: 'nowrap', fontWeight: 700 }}>{o.tipo || '—'}</TdCell>
                      <TdCell style={{ width: '75%', lineHeight: 1.55, whiteSpace: 'normal' }}>{o.descricao || '—'}</TdCell>
                    </tr>
                  ))
              }
            </tbody>
          </table>

          {/* ── Checklist (estrito: itens reais + foto de comprovação) ────
              O formulário NÃO tem perguntas Sim/Não: cada item fixo tem
              apenas situação (foto anexada = concluído) + foto. */}
          <table style={{ ...TAB, ...OUTER }}>
            <colgroup>
              <col style={{ width: '72%' }} />
              <col style={{ width: '28%' }} />
            </colgroup>
            <tbody>
              <SectionHeader title="Checklist" count={checklist.length} />
              {checklist.length === 0
                ? <EmptyRow cols={2} text="Nenhum item de checklist." />
                : checklist.map((c, i) => {
                    const anexada = !!c.foto_url;
                    return (
                      <tr key={c.item || i} style={{ background: i % 2 === 0 ? '#fff' : '#fafcff' }}>
                        <TdCell style={{ lineHeight: 1.55, whiteSpace: 'normal', width: '72%' }}>
                          {c.item || '—'}
                        </TdCell>
                        <TdCell style={{
                          width: '28%', textAlign: 'right', fontWeight: 700, fontSize: 9,
                          whiteSpace: 'nowrap',
                          color: anexada ? '#166534' : '#92400e',
                          background: anexada ? '#dcfce7' : '#fef3c7',
                        }}>
                          {anexada ? 'Anexado • Concluído' : 'Pendente'}
                        </TdCell>
                      </tr>
                    );
                  })
              }
              {checklist.some((c) => c.foto_url) && (
                <tr>
                  <TdCell colSpan={2} style={{ textAlign: 'center', padding: '6px 10px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', boxSizing: 'border-box' }}>
                      {checklist.filter((c) => c.foto_url).map((c, i) => (
                        <div key={i} style={{ textAlign: 'center', boxSizing: 'border-box' }}>
                          <img
                            src={c.foto_url}
                            alt={`Comprovação — ${c.item}`}
                            style={{
                              width: 210, height: 158, objectFit: 'cover',
                              borderRadius: 4, border: '1px solid #e2e8f0', display: 'block',
                            }}
                          />
                          <div style={{ fontSize: 9, color: '#64748b', marginTop: 3, maxWidth: 210 }}>
                            {c.item}
                          </div>
                        </div>
                      ))}
                    </div>
                  </TdCell>
                </tr>
              )}
            </tbody>
          </table>

          {/* ── Fotos (só se existirem no formulário) ───────────────────── */}
          {fotos.length > 0 && (
            <table style={{ ...TAB, ...OUTER }}>
              <tbody>
                <SectionHeader title="Fotos" count={fotos.length} />
                <tr>
                  <td style={{ ...BASE_CELL, padding: '6px 10px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, boxSizing: 'border-box' }}>
                      {fotos.map((foto, i) => (
                        <div key={i} style={{ textAlign: 'center', boxSizing: 'border-box' }}>
                          <img
                            src={foto.url}
                            alt={foto.legenda || `Foto ${i + 1}`}
                            style={{
                              width: 210, height: 158, objectFit: 'cover',
                              borderRadius: 4, border: '1px solid #e2e8f0', display: 'block',
                            }}
                          />
                          {foto.legenda && (
                            <div style={{ fontSize: 9, color: '#64748b', marginTop: 3, maxWidth: 210 }}>
                              {foto.legenda}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          {/* ── Assinaturas (só se existirem — fluxo Operador/Transporte/Planejador) */}
          {assinaturas.length > 0 && (
            <table style={{ ...TAB, ...OUTER }}>
              <tbody>
                <SectionHeader title="Assinaturas" count={assinaturas.length} />
                <tr>
                  {assinaturas.map((a, i) => {
                    const imgSrc = a.assinatura_dado || a.assinatura_url || null;
                    return (
                      <TdCell key={i} style={{ textAlign: 'center', verticalAlign: 'bottom', padding: '12px 16px', whiteSpace: 'normal' }}>
                        {imgSrc && (
                          <img
                            src={imgSrc}
                            alt={`Assinatura ${a.etapa}`}
                            style={{ height: 64, maxWidth: '100%', objectFit: 'contain', marginBottom: 6 }}
                          />
                        )}
                        <div style={{ borderTop: '1px solid #334155', paddingTop: 4, marginTop: 4 }}>
                          <div style={{ fontWeight: 700, fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.nome || '—'}</div>
                          <div style={{ fontSize: 8, color: '#64748b', marginTop: 1, whiteSpace: 'nowrap' }}>
                            {a.etapa}{a.matricula ? ` — ${a.matricula}` : ''}
                          </div>
                          {a.assinado_em && (
                            <div style={{ fontSize: 8, color: '#94a3b8', marginTop: 1, whiteSpace: 'nowrap' }}>
                              {formatarDataHora(a.assinado_em)}
                            </div>
                          )}
                        </div>
                      </TdCell>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          )}

          {/* ── Rodapé ──────────────────────────────────────────────── */}
          <div style={{
            marginTop: 10, borderTop: '1px solid #e2e8f0', paddingTop: 6,
            display: 'flex', justifyContent: 'space-between', gap: 12,
            fontSize: 8, color: '#94a3b8', boxSizing: 'border-box',
          }}>
            <span style={{ whiteSpace: 'nowrap' }}>Omega Track — Omega Service Gestão de Transporte</span>
            <span style={{ whiteSpace: 'nowrap' }}>
              Gerado em {new Date().toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>

        </div>
        {/* fim #omega-pd-print */}
      </div>
    </>
  );
}
