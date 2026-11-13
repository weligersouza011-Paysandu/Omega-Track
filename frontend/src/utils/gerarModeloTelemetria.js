// ============================================================================
// frontend/src/utils/gerarModeloTelemetria.js
//
// Gera e baixa a planilha modelo (.xlsx) da importação de Telemetria & Fadiga,
// com as colunas lidas pelo parser do back-end (telemetriaPlanilhaService.js).
// A planilha exportada direto da plataforma de telemetria também é aceita.
// ============================================================================
import * as XLSX from 'xlsx';

export const NOME_ARQUIVO_MODELO_TELEMETRIA = 'Modelo_Importacao_Telemetria.xlsx';

export const COLUNAS_MODELO_TELEMETRIA = [
  'DATA/HORA',
  'TAG/PLACA',
  'MOTORISTA',
  'EVENTO',
  'VALOR REGISTRADO',
  'VELOCIDADE LIMITE',
  'LOCALIZAÇÃO',
  'SEVERIDADE',
];

const LINHA_EXEMPLO = [
  '13/11/2026 08:30',
  'ABC-1234',
  'João Silva',
  'Fadiga / Sono',
  0,
  0,
  'Rodovia BR-155 Km 20',
  'GRAVE',
];

const INSTRUCOES = [
  ['Campo', 'Como preencher'],
  ['DATA/HORA', 'dd/mm/aaaa hh:mm (horário de Brasília). Obrigatório.'],
  ['TAG/PLACA', 'Placa ou TAG do veículo. A TAG da frota é preenchida automaticamente pela placa. Obrigatório.'],
  ['MOTORISTA', 'Nome do condutor. Usado na recorrência mensal do Anexo I.'],
  ['EVENTO', 'Excesso de Velocidade | Arrancada Brusca | Freada de Emergência | Fadiga / Sono | Uso de Celular (ou o texto da plataforma). Obrigatório.'],
  ['VALOR REGISTRADO', 'Velocidade registrada em km/h (0 quando não se aplica).'],
  ['VELOCIDADE LIMITE', 'Limite da via ou cerca em km/h (0 quando não se aplica).'],
  ['LOCALIZAÇÃO', 'Endereço ou trecho. Para aparecer no mapa, use coordenadas "lat, long" (ex.: -6.0559, -50.1277) ou acrescente as colunas LATITUDE e LONGITUDE.'],
  ['SEVERIDADE', 'NORMAL | MODERADO | GRAVE | CRITICO. Em branco: calculada pelo Anexo I do PGS-007245 (velocidade: >7% Moderado, >20% Grave, >50% ou >120 km/h Crítico).'],
  ['', ''],
  ['Observação', 'Linhas repetidas (mesma placa, data/hora e evento) não são importadas duas vezes.'],
];

/** Monta o workbook (aba "Modelo" + aba "Instruções"); separado do download para testes. */
export function montarModeloTelemetria() {
  const workbook = XLSX.utils.book_new();
  const modelo = XLSX.utils.aoa_to_sheet([COLUNAS_MODELO_TELEMETRIA, LINHA_EXEMPLO]);
  modelo['!cols'] = [18, 14, 24, 26, 18, 18, 30, 14].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, modelo, 'Modelo');
  const instrucoes = XLSX.utils.aoa_to_sheet(INSTRUCOES);
  instrucoes['!cols'] = [{ wch: 20 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, instrucoes, 'Instruções');
  return workbook;
}

export function gerarModeloTelemetria() {
  XLSX.writeFile(montarModeloTelemetria(), NOME_ARQUIVO_MODELO_TELEMETRIA);
}

export default gerarModeloTelemetria;
