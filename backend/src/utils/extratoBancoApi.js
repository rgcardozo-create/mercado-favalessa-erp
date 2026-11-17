const { chaveDe, formaDe, impressaoDigital } = require('./extratoBanco');
const { deDdmmaaaa } = require('./bbExtratosApi');

// Converte os lançamentos da API Extratos do Banco do Brasil no MESMO formato
// que `lerExtratoBanco` devolve para a planilha. Daí em diante tudo é igual: as
// regras que o dono ensinou, a trava contra duplicar e a gravação das contas
// pagas não sabem (nem precisam saber) se o extrato veio de arquivo ou da API.
//
// Os campos usados vêm da especificação OpenAPI da API Extratos v2:
// - indicadorTipoLancamento: 1 contabilizado, 2 futuro, 3 em processamento;
//   letras (SA, SD, LD...) são saldos e limites, não movimento.
// - indicadorSinalLancamento: C crédito, D débito, * valor bloqueado.
// - dataLancamento em DDMMAAAA, como número.
// - textoDescricaoSubHistorico: a natureza ("Pix - Enviado").
// - textoInformacaoComplementar: o detalhe ("13/06 21:04 FULANO").

const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function converterLancamentos(lista, bancoId = 0) {
  const saidas = [];
  const jaVistas = new Map();
  // `futuro` é novo em relação à planilha: lançamento agendado ou ainda em
  // processamento. Não é saída ainda — entra quando o banco contabilizar, numa
  // próxima busca.
  const ignoradas = { saldo: 0, entrada: 0, invalida: 0, rodape: 0, futuro: 0 };

  for (const l of lista || []) {
    const tipo = texto(l.indicadorTipoLancamento).toUpperCase();
    if (tipo === '2' || tipo === '3') { ignoradas.futuro += 1; continue; }
    if (tipo !== '1') { ignoradas.saldo += 1; continue; }

    const sinal = texto(l.indicadorSinalLancamento).toUpperCase();
    const valor = Math.round(Math.abs(Number(l.valorLancamento)) * 100) / 100;
    const data = deDdmmaaaa(l.dataLancamento);
    if (!data || !Number.isFinite(valor) || !valor || !['C', 'D'].includes(sinal)) {
      ignoradas.invalida += 1;
      continue;
    }
    if (sinal === 'C') { ignoradas.entrada += 1; continue; }

    const lancamento = texto(l.textoDescricaoSubHistorico) || `Histórico ${l.codigoHistorico ?? ''}`.trim();
    const detalhes = texto(l.textoInformacaoComplementar);
    // Documento zero é "sem documento": deixar o zero faria todo lançamento sem
    // número parecer o mesmo.
    const documento = Number(l.numeroDocumento) ? String(l.numeroDocumento) : '';
    const chave = chaveDe(lancamento, detalhes);

    const identidade = `${data}|${valor.toFixed(2)}|${documento}|${chave}`;
    const ocorrencia = (jaVistas.get(identidade) || 0) + 1;
    jaVistas.set(identidade, ocorrencia);

    saidas.push({
      data,
      lancamento,
      detalhes,
      documento,
      valor,
      forma: formaDe(lancamento),
      chave,
      impressao: impressaoDigital({ data, valor, documento, chave, ocorrencia, bancoId }),
    });
  }

  return {
    reconhecido: true,
    origem: 'api',
    // A API sempre traz os lançamentos um a um, nunca agrupados.
    modo: 'detalhado',
    colunas: [],
    saidas,
    ignoradas,
  };
}

module.exports = { converterLancamentos };
