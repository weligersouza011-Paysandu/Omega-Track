// ============================================================================
// frontend/src/utils/geradorPlanilhaModelo.js
//
// Utilitário para geração e download automático de planilhas modelo (.xlsx)
// utilizadas na importação em massa dos sub-módulos da EcoGestão.
// Utiliza a biblioteca `xlsx` (SheetJS) já disponível no projeto.
// ============================================================================
import * as XLSX from 'xlsx';

function baixarWorkbook(planilha, nomeArquivo) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, 'Modelo');
  XLSX.writeFile(workbook, nomeArquivo);
}

export function gerarModeloResiduos() {
  const dados = [
    {
      'DATA': '01/10/2026',
      'TIPO DE RESIDUO': 'SUCATA METÁLICA',
      'NUMERO MTR/MID': 'MTR-2026-001',
      'DESTINACAO': 'RECICLAGEM',
      'QUANTIDADE (KG/L)': 1500,
    },
  ];
  const planilha = XLSX.utils.json_to_sheet(dados);
  baixarWorkbook(planilha, 'Modelo_Importacao_Residuos.xlsx');
}

export function gerarModeloAgua() {
  const dados = [
    {
      'DATA': '01/10/2026',
      'PONTOS DE CAPTACAO': 'ETA/HIDROMETRO',
      'CONSUMO (M3)': 1929.0,
    },
  ];
  const planilha = XLSX.utils.json_to_sheet(dados);
  baixarWorkbook(planilha, 'Modelo_Importacao_Agua_Potavel.xlsx');
}

export function gerarModeloAtos() {
  const dados = [
    {
      'DESCRICAO DO TIPO DE SERVICO': 'CIPERPRAG - Controle de pragas',
      'STATUS': 'ATIVO',
      'LICENCA': 'CFT - Certificado de Fiscalização Técnica',
      'VALIDADE': '31/12/2026',
    },
  ];
  const planilha = XLSX.utils.json_to_sheet(dados);
  baixarWorkbook(planilha, 'Modelo_Importacao_Atos_Autorizativos.xlsx');
}

export function gerarModeloProdutosQuimicos() {
  const dados = [
    {
      'NOME DO PRODUTO QUÍMICO': 'ACETILENO DISSOLVIDO',
      'FDS/FISPQ': 'FDS-001',
      'MARCA DO PRODUTO': 'GÁS NOBRE',
      'SUBSTÂNCIAS DA COMPOSIÇÃO': 'GASES',
      'ENQUADRAMENTO DO PRODUTO': 'PERIGOSO',
      'VALIDADE DO PRODUTO': '31/12/2026',
      'LOCAL DE ARMAZENAMENTO': 'CONTAINER QUÍMICO',
      'INFLAMÁVEL?': 'SIM',
      'PIROFÓRICO?': 'NÃO',
      'EXPLOSIVO?': 'SIM',
      'OXIDANTE?': 'NÃO',
      'CORROSIVO?': 'NÃO',
      'TÓXICO?': 'NÃO',
      'RADIOATIVO?': 'NÃO',
    },
  ];
  const planilha = XLSX.utils.json_to_sheet(dados);
  baixarWorkbook(planilha, 'Modelo_Importacao_Produtos_Quimicos.xlsx');
}