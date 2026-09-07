// "request entity too large" é o que o Express diz, e não ajuda ninguém: não diz
// o que era grande demais, nem quanto cabe, nem o que fazer. Quem está subindo
// seis meses de extrato de uma vez precisa saber se divide o arquivo ou não.
//
// A rota decide o texto: falar em "dividir o arquivo" numa rota que não recebe
// arquivo mandaria a pessoa procurar um arquivo que não existe.
const CAMINHO_DE_ARQUIVO = /\/(importar|extratos|vendas-caixa)(\/|$)/;

function mensagemDe(err, caminho) {
  if (err && err.type === 'entity.too.large') {
    if (!CAMINHO_DE_ARQUIVO.test(caminho || '')) {
      return 'Os dados enviados são grandes demais para uma requisição.';
    }
    const limite = err.limit ? `${Math.round(err.limit / (1024 * 1024))} MB` : 'o limite';
    return `Arquivo grande demais para uma vez só: o envio passa de ${limite}. Divida em dois períodos e mande um de cada vez — importar duas vezes não duplica nada.`;
  }
  if (err && err.type === 'entity.parse.failed') {
    return 'Não consegui ler o que foi enviado. Tente de novo; se repetir, o arquivo pode estar corrompido.';
  }
  return (err && err.message) || 'Erro interno do servidor.';
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(err.status || 500).json({ error: mensagemDe(err, req && req.path) });
}

module.exports = errorHandler;
