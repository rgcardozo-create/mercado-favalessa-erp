require('dotenv').config();
const app = require('./app');
const { prepararBanco } = require('./db/bootstrap');

const PORT = process.env.PORT || 3000;

// O banco é preparado antes de aceitar requisições: em nuvem não há terminal
// para rodar migração à mão, e subir o servidor com o schema desatualizado só
// produziria erro na primeira tela que o usuário abrisse.
prepararBanco()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Mercado Favalessa ERP rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Falha ao preparar o banco:', err.message);
    console.error('Verifique a variável DATABASE_URL.');
    process.exit(1);
  });
