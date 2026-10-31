// Preload za testove (node --require): zahtjev za modulom "pg" dobiva lažni pg iz lazni-pg.js, pa se pravi server.js može pokrenuti bez baze.
const Module = require("module");
const lazni = require.resolve("./lazni-pg.js");
const izvorna = Module._resolveFilename;
Module._resolveFilename = function (zahtjev, ...ostalo) {
  return zahtjev === "pg" ? lazni : izvorna.call(this, zahtjev, ...ostalo);
};
