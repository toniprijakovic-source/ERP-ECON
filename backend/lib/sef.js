// Šifriranje i dešifriranje sigurnosnih kopija: AES-256-GCM, ključ se iz lozinke izvodi pomoću scrypt.
// Koristi samo ugrađenu kriptografiju Nodea — ne treba 7-Zip ni drugi alat (ni ovdje ni na serveru), a lozinka ostaje
// unutar ovog procesa (ne šalje se kao argument drugom programu, pa se ne vidi u popisu procesa ni u zapisnicima).
// GCM uz tajnost provjerava i neoštećenost: pogrešna lozinka, oštećena ili izmijenjena datoteka odmah javlja grešku,
// a ne vraća tiho krive podatke.
//
// Oblik datoteke: "ESEF" (4 B) | verzija (1 B) | sol (16 B) | iv (12 B) | oznaka GCM (16 B) | šifrirani sadržaj
const crypto = require("crypto");
const zlib = require("zlib");

const MAGIJA = Buffer.from("ESEF", "ascii");
const VERZIJA = 1;
const DULJINA_SOLI = 16;
const DULJINA_IV = 12;
const DULJINA_OZNAKE = 16;
const ZAGLAVLJE = MAGIJA.length + 1 + DULJINA_SOLI + DULJINA_IV + DULJINA_OZNAKE;
const SCRYPT = { N: 1 << 14, r: 8, p: 1 }; // oko 16 MB memorije; dovoljno za grubu silu uz dugu lozinku, ispod zadane granice Nodea
const MIN_DULJINA_LOZINKE = 16;

const izvediKljuc = (lozinka, sol) => crypto.scryptSync(lozinka, sol, 32, SCRYPT);

function provjeriLozinku(lozinka) {
  if (typeof lozinka !== "string" || lozinka.length < MIN_DULJINA_LOZINKE) {
    throw new Error(`Lozinka za šifriranje mora imati najmanje ${MIN_DULJINA_LOZINKE} znakova.`);
  }
}

// podaci: Buffer ili tekst. Vraća jedan Buffer spreman za spremanje u datoteku.
function sifriraj(podaci, lozinka) {
  provjeriLozinku(lozinka);
  const sol = crypto.randomBytes(DULJINA_SOLI);
  const iv = crypto.randomBytes(DULJINA_IV);
  const cipher = crypto.createCipheriv("aes-256-gcm", izvediKljuc(lozinka, sol), iv);
  const sifrirano = Buffer.concat([cipher.update(Buffer.isBuffer(podaci) ? podaci : Buffer.from(String(podaci), "utf8")), cipher.final()]);
  return Buffer.concat([MAGIJA, Buffer.from([VERZIJA]), sol, iv, cipher.getAuthTag(), sifrirano]);
}

// datoteka: Buffer s cijelim sadržajem .sef datoteke. Vraća Buffer s izvornim podacima ili baca grešku.
function desifriraj(datoteka, lozinka) {
  provjeriLozinku(lozinka);
  if (!Buffer.isBuffer(datoteka) || datoteka.length < ZAGLAVLJE || !datoteka.subarray(0, MAGIJA.length).equals(MAGIJA)) {
    throw new Error("Ovo nije valjana .sef datoteka (krivi ili prekratak zapis).");
  }
  let p = MAGIJA.length;
  const verzija = datoteka[p++];
  if (verzija !== VERZIJA) throw new Error(`Nepoznata verzija formata (${verzija}); ova skripta razumije verziju ${VERZIJA}.`);
  const sol = datoteka.subarray(p, p += DULJINA_SOLI);
  const iv = datoteka.subarray(p, p += DULJINA_IV);
  const oznaka = datoteka.subarray(p, p += DULJINA_OZNAKE);
  const sifrirano = datoteka.subarray(p);
  const decipher = crypto.createDecipheriv("aes-256-gcm", izvediKljuc(lozinka, sol), iv);
  decipher.setAuthTag(oznaka);
  try {
    return Buffer.concat([decipher.update(sifrirano), decipher.final()]);
  } catch {
    throw new Error("Dešifriranje nije uspjelo: pogrešna lozinka ili je datoteka oštećena/izmijenjena.");
  }
}

// Cijeli put paketa: objekt → JSON → gzip → šifriranje. JSON se dobro sažima (obično 8–10 puta), pa satne kopije kroz 30 dana,
// dnevne kroz godinu i mjesečne trajno zauzimaju malo prostora. (Sažima se PRIJE šifriranja; poslije šifriranja sažimanje ne bi imalo smisla.)
function pakiraj(objekt, lozinka) {
  return sifriraj(zlib.gzipSync(Buffer.from(JSON.stringify(objekt), "utf8"), { level: 9 }), lozinka);
}

// Obrnuto od pakiraj(). Razumije i nesažet JSON (stariji oblik), pa se prepoznaje po gzip zaglavlju (1f 8b).
function otpakiraj(datoteka, lozinka) {
  let sadrzaj = desifriraj(datoteka, lozinka);
  if (sadrzaj.length > 2 && sadrzaj[0] === 0x1f && sadrzaj[1] === 0x8b) {
    try { sadrzaj = zlib.gunzipSync(sadrzaj); } catch { throw new Error("Datoteka se dešifrirala, ali sažeti sadržaj je neispravan."); }
  }
  try { return JSON.parse(sadrzaj.toString("utf8")); } catch { throw new Error("Datoteka se dešifrirala, ali sadržaj nije valjan JSON."); }
}

module.exports = { sifriraj, desifriraj, pakiraj, otpakiraj, MIN_DULJINA_LOZINKE };
