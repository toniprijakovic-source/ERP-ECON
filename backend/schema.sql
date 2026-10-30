-- ČELIK-MONT / Econ ERP — shema baze (Postgres)
-- Pristup: "key-value" tablica koja čuva iste JSON strukture koje frontend
-- već koristi (isti oblik kao window.storage). Ovo je namjerno NAJBRŽI i
-- najmanje rizičan prvi korak — prava relacijska normalizacija (zasebne
-- tablice s foreign keyevima za projekte, fakture, stavke...) može doći
-- kasnije, kad app bude stabilna u produkciji.

CREATE TABLE IF NOT EXISTS app_data (
  key         TEXT PRIMARY KEY CHECK (key IN (
                'kupci','dobavljaci','materijali','projekti','narudzbenice','ponude',
                'radniNalozi','fakture','cjenikRada','katalogProfila','pozicijeZaposlenika',
                'zaposlenici','standardniZadaci','programiRezanja','kapacitetiDana',
                'postavkeTvrtke','upitiNabave','radniCentri','evidencijaRada',
                'narudzbe','otpremnice','podlogeZaFakturu','normativi',
                'postavkePlaca','praznici','kvaliteteMaterijala','ponudeLasera','doplaciPlaca',
                'satiPoNalogu','izdatnice','cmr','slobodniZadaci','planProizvodnje','nedovrsenaProizvodnja','rezervacije','maticnaKnjiga','upitiTransporta','narudzbeTransporta','godisnjiOdmor'
              )),
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log prijava (korisno za reviziju tko je i kad ulazio)
CREATE TABLE IF NOT EXISTS login_log (
  id            BIGSERIAL PRIMARY KEY,
  zaposlenik_id TEXT NOT NULL,
  vrijeme       TIMESTAMPTZ NOT NULL DEFAULT now(),
  uspjesno      BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_log_zaposlenik ON login_log (zaposlenik_id, vrijeme DESC);

-- Povijest korekcija bodova/plaća (puni se automatski na poslužitelju; stvara je i server pri pokretanju)
CREATE TABLE IF NOT EXISTS korekcije_bodova (
  id            BIGSERIAL PRIMARY KEY,
  vrijeme       TIMESTAMPTZ NOT NULL DEFAULT now(),
  zaposlenik_id TEXT,
  zaposlenik    TEXT NOT NULL DEFAULT '',
  polje         TEXT NOT NULL,
  naziv         TEXT NOT NULL,
  tip           TEXT NOT NULL DEFAULT 'tekst',
  staro         TEXT NOT NULL DEFAULT '',
  novo          TEXT NOT NULL DEFAULT '',
  korisnik_id   TEXT,
  korisnik      TEXT NOT NULL DEFAULT '',
  razlog        TEXT
);
CREATE INDEX IF NOT EXISTS idx_korekcije_bodova_vrijeme ON korekcije_bodova (vrijeme DESC);
