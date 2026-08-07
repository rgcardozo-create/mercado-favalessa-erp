require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Mercado Favalessa ERP backend rodando na porta ${PORT}`);
});
