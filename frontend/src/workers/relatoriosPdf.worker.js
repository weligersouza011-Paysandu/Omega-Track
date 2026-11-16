import { criarMotorRelatoriosPdf } from '../utils/motorRelatoriosPdf.js';

const motor = criarMotorRelatoriosPdf({
  onProgresso: (progresso) => self.postMessage({ tipo: 'progresso', progresso }),
});
self.onmessage = async ({ data }) => {
  try {
    let resultado;
    if (data.tipo === 'lote') await motor.processarLote(data.arquivos, data.total);
    else if (data.tipo === 'finalizar') resultado = await motor.finalizar();
    else throw new Error('Operação de exportação inválida.');
    self.postMessage({ tipo: 'resultado', id: data.id, resultado }, resultado instanceof ArrayBuffer ? [resultado] : []);
  } catch (erro) {
    self.postMessage({ tipo: 'erro', id: data.id, mensagem: erro.message });
  }
};
