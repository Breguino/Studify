// Atenei italiani con le sigle più usate. Serve solo per l'autocompletamento e per risolvere
// «UNIBS» → «Università degli Studi di Brescia»: il campo resta libero per tutti gli altri casi.
export const UNIVERSITIES = [
  ["Università degli Studi di Brescia", "UNIBS"],
  ["Politecnico di Milano", "POLIMI"],
  ["Politecnico di Torino", "POLITO"],
  ["Politecnico di Bari", "POLIBA"],
  ["Alma Mater Studiorum — Università di Bologna", "UNIBO"],
  ["Università degli Studi di Milano", "UNIMI", "La Statale"],
  ["Università degli Studi di Milano-Bicocca", "UNIMIB", "Bicocca"],
  ["Università Cattolica del Sacro Cuore", "UCSC", "Cattolica"],
  ["Università Commerciale Luigi Bocconi", "Bocconi"],
  ["Università degli Studi di Padova", "UNIPD"],
  ["Università degli Studi di Pavia", "UNIPV"],
  ["Università degli Studi di Bergamo", "UNIBG"],
  ["Università degli Studi di Verona", "UNIVR"],
  ["Università Ca' Foscari Venezia", "UNIVE", "Ca Foscari"],
  ["Università Iuav di Venezia", "IUAV"],
  ["Università degli Studi di Trento", "UNITN"],
  ["Università degli Studi di Trieste", "UNITS"],
  ["Università degli Studi di Udine", "UNIUD"],
  ["Università degli Studi di Parma", "UNIPR"],
  ["Università degli Studi di Modena e Reggio Emilia", "UNIMORE"],
  ["Università degli Studi di Ferrara", "UNIFE"],
  ["Università degli Studi di Genova", "UNIGE"],
  ["Università degli Studi di Torino", "UNITO"],
  ["Università del Piemonte Orientale", "UNIUPO"],
  ["Università degli Studi dell'Insubria", "UNINSUBRIA", "Insubria"],
  ["Università degli Studi di Firenze", "UNIFI"],
  ["Università di Pisa", "UNIPI"],
  ["Università degli Studi di Siena", "UNISI"],
  ["Università degli Studi di Perugia", "UNIPG"],
  ["Sapienza Università di Roma", "SAPIENZA", "UNIROMA1"],
  ["Università degli Studi di Roma Tor Vergata", "UNIROMA2", "Tor Vergata"],
  ["Università degli Studi Roma Tre", "UNIROMA3", "Roma Tre"],
  ["LUISS Guido Carli", "LUISS"],
  ["Università degli Studi di Napoli Federico II", "UNINA", "Federico II"],
  ["Università degli Studi della Campania Luigi Vanvitelli", "UNICAMPANIA", "Vanvitelli"],
  ["Università degli Studi di Bari Aldo Moro", "UNIBA"],
  ["Università degli Studi di Salerno", "UNISA"],
  ["Università degli Studi di Palermo", "UNIPA"],
  ["Università degli Studi di Catania", "UNICT"],
  ["Università degli Studi di Messina", "UNIME"],
  ["Università degli Studi di Cagliari", "UNICA"],
  ["Università degli Studi di Sassari", "UNISS"],
  ["Università della Calabria", "UNICAL"],
  ["Università Politecnica delle Marche", "UNIVPM"],
  ["Università degli Studi di Macerata", "UNIMC"],
  ["Università degli Studi di Urbino Carlo Bo", "UNIURB"],
  ["Università di Camerino", "UNICAM"],
  ["Università degli Studi G. d'Annunzio Chieti-Pescara", "UNICH"],
  ["Università degli Studi dell'Aquila", "UNIVAQ"],
  ["Università degli Studi del Molise", "UNIMOL"],
  ["Università degli Studi della Basilicata", "UNIBAS"],
  ["Università del Salento", "UNISALENTO"],
  ["Università degli Studi di Foggia", "UNIFG"],
  ["Università degli Studi della Tuscia", "UNITUS"],
  ["Università degli Studi di Cassino e del Lazio Meridionale", "UNICAS"],
  ["Libera Università di Lingue e Comunicazione IULM", "IULM"],
  ["Università Vita-Salute San Raffaele", "UNISR", "San Raffaele"],
  ["Humanitas University", "HUNIMED"],
];

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Nome ufficiale se `text` è una sigla/alias/nome noto (senza distinguere maiuscole e accenti), altrimenti null. */
export function resolveUniversity(text) {
  const t = norm(text ?? "");
  if (!t) return null;
  for (const [name, ...aliases] of UNIVERSITIES) if ([name, ...aliases].some((a) => norm(a) === t)) return name;
  return null;
}
