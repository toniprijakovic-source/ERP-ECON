// Razlika popisa programa rezanja za ciljano spremanje (PUT /api/programiRezanja/patch): što dodati/izmijeniti (upsert), što ukloniti (remove) i — samo ako je
// ovom izmjenom promijenjen red čekanja — redoslijed id-eva. Redoslijed se ne šalje uz svaku izmjenu: preglednik sa zastarjelim redoslijedom inače bi
// vratio tuđi pomak programa gore/dolje.
export function razlikaProgramaRezanja(stari = [], novi = []) {
  const staroJson = new Map(stari.map((p) => [p.id, JSON.stringify(p)]));
  const noviIds = new Set(novi.map((p) => p.id));
  const upsert = novi.filter((p) => staroJson.get(p.id) !== JSON.stringify(p));
  const remove = stari.filter((p) => !noviIds.has(p.id)).map((p) => p.id);
  // Redoslijed zajedničkih programa promijenjen (pomak) ili je novi program umetnut ispred nekog postojećeg (nastavak iza podijeljenog programa).
  const zajednickiStari = stari.map((p) => p.id).filter((id) => noviIds.has(id));
  const zajednickiNovi = novi.map((p) => p.id).filter((id) => staroJson.has(id));
  const pomaknut = zajednickiStari.some((id, i) => id !== zajednickiNovi[i]);
  const umetnut = novi.some((p, i) => !staroJson.has(p.id) && novi.slice(i + 1).some((q) => staroJson.has(q.id)));
  return { upsert, remove, redoslijed: pomaknut || umetnut ? novi.map((p) => p.id) : undefined };
}
