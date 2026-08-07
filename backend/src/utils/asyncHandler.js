// Evita repetir try/catch em toda rota async — encaminha erros para o middleware de erro.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
