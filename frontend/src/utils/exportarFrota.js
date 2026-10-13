import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const COR = {
  cabecalhoFundo: '0F2743',
  tituloFundo: '0F2743',
  borda: 'D4DAE3',
  zebra: 'F2F5FA',
  verdeFundo: 'E6F4EA',
  verdeTexto: '1E7E34',
  vermelhoFundo: 'FDECEA',
  vermelhoTexto: '9E2B25',
  link: '2563EB',
};

function dataHoraNome() {
  const agora = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}`;
}

function dataHoraPtBr() {
  return new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function paraDataExcel(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function rotuloFiltros({ status, contrato, busca }) {
  const partes = [];
  if (status && status !== 'todos') partes.push(`Status: ${status}`);
  if (contrato && contrato !== 'todos') partes.push(`Contrato: ${contrato}`);
  if (busca && busca.trim() !== '') partes.push(`Busca: "${busca.trim()}"`);
  return partes.length > 0 ? partes.join(' • ') : 'Sem filtros (frota completa)';
}

// Gera e baixa planilha Excel estilizada da frota (usa os veículos já filtrados da galeria).
export async function exportarFrotaExcel(veiculos = [], meta = {}) {
  const linhas = Array.isArray(veiculos) ? veiculos : [];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'OmegaTrack';
  wb.created = new Date();

  const ws = wb.addWorksheet('Frota', {
    properties: { tabColor: { argb: 'FF0F2743' } },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [
    { header: 'TAG', key: 'tag', width: 12 },
    { header: 'Placa', key: 'placa', width: 12 },
    { header: 'Modelo', key: 'modelo', width: 30 },
    { header: 'Contrato', key: 'contrato', width: 24 },
    { header: 'Status', key: 'status', width: 17 },
    { header: 'Data MOB', key: 'data_mob', width: 13 },
    { header: 'Data DESMOB', key: 'data_desmob', width: 14 },
    { header: 'Foto (URL)', key: 'foto', width: 55 },
  ];

  // Linha 1 — título
  ws.mergeCells('A1:H1');
  const titulo = ws.getCell('A1');
  titulo.value = 'OmegaTrack — Frota Mobilização & Desmobilização';
  titulo.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COR.tituloFundo}` } };
  titulo.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 26;

  // Linha 2 — subtítulo
  ws.mergeCells('A2:H2');
  const subt = ws.getCell('A2');
  subt.value = `Exportado em ${dataHoraPtBr()} • ${linhas.length} veículo(s) • ${rotuloFiltros(meta)}`;
  subt.font = { size: 10, italic: true, color: { argb: 'FF5B6B82' } };
  subt.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(2).height = 18;

  // Linha 3 — cabeçalho
  const headerRow = ws.getRow(3);
  headerRow.values = ['TAG', 'Placa', 'Modelo', 'Contrato', 'Status', 'Data MOB', 'Data DESMOB', 'Foto (URL)'];
  headerRow.height = 20;
  headerRow.eachCell((cell) => {
    cell.font = { size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COR.cabecalhoFundo}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: `FF${COR.borda}` } },
      bottom: { style: 'thin', color: { argb: `FF${COR.borda}` } },
      left: { style: 'thin', color: { argb: `FF${COR.borda}` } },
      right: { style: 'thin', color: { argb: `FF${COR.borda}` } },
    };
  });

  // Linhas de dados a partir da linha 4
  linhas.forEach((v, idx) => {
    const row = ws.addRow({
      tag: v.tag || '',
      placa: v.placa || '',
      modelo: v.modelo || v.categoria || '',
      contrato: String(v.contrato || '').trim(),
      status: v.status || '',
      data_mob: paraDataExcel(v.data_mob),
      data_desmob: paraDataExcel(v.data_desmob),
      foto: v.foto_veiculo || '',
    });
    const ehZebra = idx % 2 === 1;
    row.eachCell((cell, colNumber) => {
      cell.font = { size: 11, color: { argb: 'FF1F2A37' } };
      cell.alignment = { vertical: 'middle', wrapText: colNumber === 3 || colNumber === 4 || colNumber === 8 };
      if (colNumber === 1 || colNumber === 2 || colNumber === 5) cell.alignment.horizontal = 'center';
      if (ehZebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COR.zebra}` } };
      cell.border = {
        top: { style: 'thin', color: { argb: `FF${COR.borda}` } },
        bottom: { style: 'thin', color: { argb: `FF${COR.borda}` } },
        left: { style: 'thin', color: { argb: `FF${COR.borda}` } },
        right: { style: 'thin', color: { argb: `FF${COR.borda}` } },
      };
    });

    const statusCell = row.getCell(5);
    if (v.status === 'Mobilizado') {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COR.verdeFundo}` } };
      statusCell.font = { size: 11, bold: true, color: { argb: `FF${COR.verdeTexto}` } };
    } else if (v.status === 'Desmobilizado') {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COR.vermelhoFundo}` } };
      statusCell.font = { size: 11, bold: true, color: { argb: `FF${COR.vermelhoTexto}` } };
    }

    row.getCell(6).numFmt = 'dd/mm/yyyy';
    row.getCell(7).numFmt = 'dd/mm/yyyy';

    const fotoCell = row.getCell(8);
    if (v.foto_veiculo) {
      fotoCell.value = { text: v.foto_veiculo, hyperlink: v.foto_veiculo };
      fotoCell.font = { size: 10, color: { argb: `FF${COR.link}` }, underline: true };
    }
  });

  ws.views = [{ state: 'frozen', ySplit: 3 }];
  ws.autoFilter = { from: 'A3', to: `H${3 + linhas.length}` };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, `frota-mobilizacao-${dataHoraNome()}.xlsx`);
  return linhas.length;
}
