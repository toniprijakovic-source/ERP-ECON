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
                'narudzbe','otpremnice','podlogeZaFakturu'
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
