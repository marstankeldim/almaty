/**
 * The registry of destinations. Only Trans-Ili Alatau exists as a scene today;
 * the rest are seeds — dark stars waiting to be discovered.
 */
export const LOCATIONS = [
  { id: 'trans-ili-alatau', name: 'Trans-Ili Alatau', lon: 77.35, lat: 43.05, unlocked: true },
  { id: 'big-almaty-lake',  name: 'Big Almaty Lake',  lon: 76.98, lat: 43.05 },
  { id: 'kolsai-lakes',     name: 'Kolsai Lakes',     lon: 78.32, lat: 42.93 },
  { id: 'kaindy-lake',      name: 'Kaindy Lake',      lon: 78.47, lat: 42.98 },
  { id: 'charyn-canyon',    name: 'Charyn Canyon',    lon: 79.08, lat: 43.35 },
  { id: 'altyn-emel',       name: 'Altyn-Emel',       lon: 78.85, lat: 44.15 },
  { id: 'singing-dune',     name: 'Singing Dune',     lon: 78.57, lat: 44.30 },
  { id: 'bozzhyra',         name: 'Bozzhyra',         lon: 51.75, lat: 43.42 },
  { id: 'mangystau',        name: 'Mangystau',        lon: 52.90, lat: 44.00 },
  { id: 'ustyurt-plateau',  name: 'Ustyurt Plateau',  lon: 55.20, lat: 43.60 },
  { id: 'caspian-coast',    name: 'Caspian Coast',    lon: 51.20, lat: 44.60 },
  { id: 'turkistan',        name: 'Turkistan',        lon: 68.25, lat: 43.30 },
  { id: 'aksu-zhabagly',    name: 'Aksu-Zhabagly',    lon: 70.55, lat: 42.40 },
  { id: 'burabay',          name: 'Burabay',          lon: 70.30, lat: 53.08 },
  { id: 'bayanaul',         name: 'Bayanaul',         lon: 75.70, lat: 50.80 },
  { id: 'katon-karagay',    name: 'Katon-Karagay',    lon: 85.60, lat: 49.20 },
  { id: 'markakol-lake',    name: 'Markakol Lake',    lon: 85.75, lat: 48.75 },
];

const KEY = 'kz-atlas-discovered';

export function loadDiscovered() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(v) && v.length) return v;
  } catch { /* fresh atlas */ }
  return ['trans-ili-alatau'];
}

export function saveDiscovered(ids) {
  localStorage.setItem(KEY, JSON.stringify(ids));
}

export function discover(id) {
  const ids = loadDiscovered();
  if (!ids.includes(id)) {
    ids.push(id);
    saveDiscovered(ids);
  }
  return ids;
}
