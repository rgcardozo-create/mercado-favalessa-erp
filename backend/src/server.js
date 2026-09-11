require('dotenv').config();
const app = require('./app');
const { prepararBanco } = require('./db/bootstrap');

const PORT = process.env.PORT || 3000;

// Quanto esperar entre uma tentativa e a seguinte, em segundos. A soma fica
// abaixo do healthcheckTimeout do Railway (60s), então o serviço ainda responde
// ao teste de saúde dentro da janela dele.
const ESPERAS = [1, 2, 3, 5, 8, 13];

const dormir = (s) => new Promise((r) => setTimeout(r, s * 1000));

// O banco é preparado antes de aceitar requisições: em nuvem não há terminal
// para rodar migração à mão, e subir com o schema desatualizado só produziria
// erro na primeira tela que o usuário abrisse.
//
// Mas desistir na primeira falha é pior. Depois de um deploy o banco às vezes
// ainda está subindo, e uma indisponibilidade de segundos derrubava o serviço
// de vez: o processo saía, o Railway reiniciava, e esgotadas as tentativas o
// endereço ficava sem nada atrás — a tela de "o trem não chegou à estação",
// que não volta sozinha.
//
// Por isso insiste. Se o banco aparecer em meio minuto, ninguém percebe nada.
async function subir() {
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      await prepararBanco();
      app.listen(PORT, () => {
        console.log(`Mercado Favalessa ERP rodando na porta ${PORT}`);
      });
      return;
    } catch (err) {
      const espera = ESPERAS[tentativa];
      if (espera === undefined) {
        console.error('Falha ao preparar o banco:', err.message);
        console.error('Verifique a variável DATABASE_URL e se o banco está de pé.');
        process.exit(1);
      }
      console.warn(
        `Banco ainda não respondeu (${err.message}). Tentando de novo em ${espera}s — ` +
          `tentativa ${tentativa + 2} de ${ESPERAS.length + 1}.`
      );
      await dormir(espera);
    }
  }
}

subir();
