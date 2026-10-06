import { test } from "node:test";
import assert from "node:assert/strict";
import { careerStats, counts, examsFor, gradeLabel, parseGrade, parseLibretto } from "../public/js/career.js";

test("voti: 18-30, lode, idoneità; il resto non è un voto", () => {
  assert.deepEqual([parseGrade("28"), parseGrade("30L"), parseGrade("30 e lode"), parseGrade("28/30"), parseGrade("IDO"), parseGrade("Approvato")],
    [{ grade: 28, laude: false }, { grade: 30, laude: true }, { grade: 30, laude: true }, { grade: 28, laude: false }, { idoneo: true }, { idoneo: true }]);
  assert.deepEqual([parseGrade("17"), parseGrade("31"), parseGrade("28L"), parseGrade("")], [null, null, { grade: 28, laude: false }, null], "la lode solo con il 30");
  assert.deepEqual([gradeLabel({ grade: 30, laude: true }), gradeLabel({ idoneo: true }), gradeLabel({ grade: 24 })], ["30 e lode", "idoneo", "24"]);
});

test("a che punto sei: esami e CFU, media pesata sui CFU (lode 30, idoneità fuori), base di laurea; a scelta solo se scelti", () => {
  const courses = [
    { name: "Analisi", cfu: 12, kind: "obbligatorio", passed: { grade: 24 } },
    { name: "Micro", cfu: 9, kind: "obbligatorio", passed: { grade: 30, laude: true } },
    { name: "Inglese", cfu: 3, kind: "obbligatorio", passed: { idoneo: true } },
    { name: "Diritto", cfu: 6, kind: "obbligatorio", passed: { grade: 27 } },
    { name: "Statistica", cfu: 9, kind: "obbligatorio" },
    { name: "Teoria dei giochi", cfu: 6, kind: "a_scelta", group: "A scelta: area economica" },
    { name: "Econometria", cfu: 6, kind: "a_scelta", group: "A scelta: area economica", planned: true },
    { name: "Insegnamenti a scelta dello studente", cfu: 12, kind: "a_scelta", group: "" },
  ];
  assert.deepEqual(courses.map(counts), [true, true, true, true, true, false, true, true]);
  const s = careerStats(courses);
  assert.deepEqual([s.total, s.passed, s.cfuTotal, s.cfuPassed, s.laudes], [7, 4, 57, 30, 1]);
  assert.equal(s.average, 26.67, "(24·12 + 30·9 + 27·6) / 27: l'esame da 12 CFU pesa di più");
  assert.equal(s.simple, 27);
  assert.equal(s.base110, 97.78);
  assert.deepEqual(s.todo.map((c) => c.name), ["Statistica", "Econometria", "Insegnamenti a scelta dello studente"]);
  assert.equal(careerStats([{ name: "x", cfu: 6, kind: "obbligatorio" }]).average, null, "nessun voto: niente media");
});

test("libretto copiato da Esse3: righe con voto e data, abbinate al piano; le altre ignorate", () => {
  const txt = `Anno\tAttività didattica\tPeso (CFU)\tStato\tVoto - Data Esame
1\t70012 - ANALISI MATEMATICA I\t9\tSuperata\t28 - 12/01/2025
1\t70013 - MICROECONOMIA\t9\tSuperata\t30L - 15/02/2025
1\t70014 - LINGUA INGLESE\t3\tSuperata\tIDO - 20/06/2025
2\t70020 - STATISTICA\t9\tFrequentata\t
Diritto privato | 6 | 30 e lode | 03.07.2025
Macroeconomia 9 CFU 24/30 18/09/2025`;
  const plan = [{ name: "Analisi matematica I", cfu: 9 }, { name: "Analisi matematica II", cfu: 9 }, { name: "Microeconomia", cfu: 9 }, { name: "Statistica", cfu: 9 }];
  const rows = parseLibretto(txt, plan);
  assert.deepEqual(rows.map((r) => [r.name, r.cfu, r.passed.date, r.passed.grade ?? "ido", r.course?.name ?? null]), [
    ["ANALISI MATEMATICA I", 9, "2025-01-12", 28, "Analisi matematica I"],
    ["MICROECONOMIA", 9, "2025-02-15", 30, "Microeconomia"],
    ["LINGUA INGLESE", 3, "2025-06-20", "ido", null],
    ["Diritto privato", 6, "2025-07-03", 30, null],
    ["Macroeconomia", 9, "2025-09-18", 24, null],
  ]);
  assert.equal(rows[1].passed.laude, true);
  assert.equal(rows.some((r) => /STATISTICA/i.test(r.name)), false, "frequentata, senza voto: non è superata");
  assert.deepEqual(examsFor([{ name: "Microeconomia (demo)" }, { name: "Analisi matematica II" }], plan[0]).map((e) => e.name), [], "«Analisi matematica II» non è la I");
  assert.deepEqual(examsFor([{ name: "Microeconomia (demo)" }], plan[2]).map((e) => e.name), ["Microeconomia (demo)"]);
});
