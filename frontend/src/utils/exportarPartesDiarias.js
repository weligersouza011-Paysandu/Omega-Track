import ExcelJS from 'exceljs';
import FileSaver from 'file-saver';
import { extrairPartesData, formatarDataSemTimezone } from './datas.js';

export function criarPlanilhaPartesDiarias(partes, filtros) {
  const planilha = new ExcelJS.Workbook();
  planilha.creator = 'Omega Track';
  planilha.created = new Date();
  const aba = planilha.addWorksheet('Partes Diárias', {
    properties: { tabColor: { argb: 'FF2563EB' } },
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  aba.columns = [{ width: 25 }, { width: 52 }, { width: 24 }, { width: 17 }];
  aba.mergeCells('A1:D1');
  const titulo = aba.getCell('A1');
  titulo.value = 'OMEGA TRACK • PARTES DIÁRIAS';
  titulo.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  titulo.alignment = { vertical: 'middle' };
  aba.getRow(1).height = 34;
  aba.mergeCells('A2:D2');
  const extras = [
    filtros.status && filtros.status !== 'todos' ? `Status: ${filtros.status}` : '',
    filtros.assinatura && filtros.assinatura !== 'todos' ? `Assinatura: ${filtros.assinatura}` : '',
    filtros.busca?.trim() ? `Busca: ${filtros.busca.trim()}` : '',
  ].filter(Boolean);
  aba.getCell('A2').value = `Dia: ${formatarDataSemTimezone(filtros.data)} • ${partes.length} registro(s)${extras.length ? ` • ${extras.join(' • ')}` : ''}`;
  aba.getCell('A2').font = { name: 'Calibri', size: 11, color: { argb: 'FF475569' } };
  aba.getCell('A2').alignment = { vertical: 'middle', wrapText: true };
  aba.getRow(2).height = extras.length ? 36 : 24;

  aba.addTable({
    name: 'PartesDiarias', ref: 'A4', headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: ['Matrícula do operador', 'Nome do operador', 'TAG do veículo', 'Data']
      .map((name) => ({ name, filterButton: true })),
    rows: partes.map((parte) => {
      const dia = extrairPartesData(parte.data);
      return [String(parte.operador ?? ''), String(parte.funcionario ?? ''), String(parte.tag ?? ''),
        dia ? new Date(Date.UTC(Number(dia.ano), Number(dia.mes) - 1, Number(dia.dia))) : null];
    }),
  });
  aba.getRow(4).height = 28;
  aba.getRow(4).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  aba.getRow(4).alignment = { vertical: 'middle' };
  aba.getRow(4).eachCell((celula) => {
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  });
  for (let linha = 5; linha <= partes.length + 4; linha += 1) {
    const registro = aba.getRow(linha);
    registro.height = 24;
    registro.font = { name: 'Calibri', size: 11, color: { argb: 'FF0F172A' } };
    registro.alignment = { vertical: 'middle' };
    registro.getCell(1).numFmt = '@'; // Matrículas preservam os zeros à esquerda.
    registro.getCell(2).alignment = { vertical: 'middle', wrapText: true };
    if (String(registro.getCell(2).value).length > 48) registro.height = 36;
    registro.getCell(3).numFmt = '@';
    registro.getCell(4).numFmt = 'dd/mm/yyyy';
  }
  aba.pageSetup.printTitlesRow = '1:4';
  aba.pageSetup.printArea = `A1:D${partes.length + 4}`;
  return planilha;
}

export async function exportarPartesDiariasExcel(partes, filtros) {
  const planilha = criarPlanilhaPartesDiarias(partes, filtros);
  const buffer = await planilha.xlsx.writeBuffer();
  const arquivo = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  FileSaver.saveAs(arquivo, `partes-diarias-${filtros.data}.xlsx`);
}
