// Testovi čistih funkcija za fotografije utovara: dimenzije, adresa QR veze, stanja i grupiranje za karticu projekta.
import test from "node:test";
import assert from "node:assert/strict";
import { skalirajDimenzije, adresaUtovara, tokenIzUpita, stanjeSlike, grupirajPoDatumu } from "./utovarFotografije.js";

test("skalirajDimenzije: duža strana na granicu, omjer ostaje, nikad povećanje", () => {
  assert.deepEqual(skalirajDimenzije(4000, 3000, 1600), { sirina: 1600, visina: 1200 });
  assert.deepEqual(skalirajDimenzije(3000, 4000, 1600), { sirina: 1200, visina: 1600 });
  assert.deepEqual(skalirajDimenzije(800, 600, 1600), { sirina: 800, visina: 600 });
  assert.deepEqual(skalirajDimenzije(4000, 3000, 240), { sirina: 240, visina: 180 });
  assert.deepEqual(skalirajDimenzije(10, 5000, 240), { sirina: 1, visina: 240 });
  assert.deepEqual(skalirajDimenzije(0, 100, 240), { sirina: 0, visina: 0 });
  assert.deepEqual(skalirajDimenzije(undefined, undefined, 240), { sirina: 0, visina: 0 });
});

test("adresa QR veze i čitanje tokena iz adrese", () => {
  const a = adresaUtovara("https://erp-econ.vercel.app", "/", "otp-abc-1.Xy_Z-9");
  assert.equal(a, "https://erp-econ.vercel.app/?utovar=otp-abc-1.Xy_Z-9");
  assert.equal(tokenIzUpita("?utovar=otp-abc-1.Xy_Z-9"), "otp-abc-1.Xy_Z-9");
  assert.equal(tokenIzUpita(new URL(a).search), "otp-abc-1.Xy_Z-9");
  assert.equal(tokenIzUpita("?kiosk=1"), "");
  assert.equal(tokenIzUpita(""), "");
  assert.equal(adresaUtovara("http://localhost:4173", "", "t.p"), "http://localhost:4173/?utovar=t.p");
});

test("stanjeSlike: spremljeno / greška / čeka", () => {
  assert.equal(stanjeSlike({ spremljenoZ: "2026-11-24T10:00:00Z", greskaZ: "" }), "spremljeno");
  assert.equal(stanjeSlike({ spremljenoZ: null, greskaZ: "nema mape" }), "greska");
  assert.equal(stanjeSlike({ spremljenoZ: null, greskaZ: "" }), "ceka");
  assert.equal(stanjeSlike(null), "ceka");
});

test("grupirajPoDatumu: najnoviji datum prvi, po otpremnici, zbrojevi i prva greška", () => {
  const s = (datum, otpremnica, redni, o = {}) => ({ id: `${datum}-${otpremnica}-${redni}`, datum, otpremnica, redni, spremljenoZ: null, greskaZ: "", ...o });
  const g = grupirajPoDatumu([
    s("2026-11-20", "OTP-2/26", 1, { spremljenoZ: "x" }), s("2026-11-20", "OTP-2/26", 2, { spremljenoZ: "x" }),
    s("2026-11-24", "OTP-10/26", 2), s("2026-11-24", "OTP-9/26", 1, { greskaZ: "Mapa nije pronađena" }), s("2026-11-24", "OTP-10/26", 1, { spremljenoZ: "x" }),
  ]);
  assert.deepEqual(g.map((x) => x.datum), ["2026-11-24", "2026-11-20"]);
  assert.deepEqual(g[0].otpremnice.map((o) => o.broj), ["OTP-9/26", "OTP-10/26"], "prirodni poredak brojeva otpremnica");
  assert.deepEqual(g[0].otpremnice[1].slike.map((x) => x.redni), [1, 2], "slike po rednom broju");
  assert.equal(g[0].ukupno, 3); assert.equal(g[0].spremljeno, 1); assert.equal(g[0].greske, 1); assert.equal(g[0].ceka, 1);
  assert.equal(g[0].stanje, "greska"); assert.equal(g[0].prvaGreska, "Mapa nije pronađena");
  assert.equal(g[1].stanje, "spremljeno"); assert.equal(g[1].ukupno, 2);
  assert.deepEqual(grupirajPoDatumu([]), []);
  assert.deepEqual(grupirajPoDatumu(null), []);
  const cekaju = grupirajPoDatumu([s("2026-11-24", "OTP-1/26", 1)]);
  assert.equal(cekaju[0].stanje, "ceka");
});
