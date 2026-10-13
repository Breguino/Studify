import { test } from "node:test";
import assert from "node:assert/strict";
import { fileIdOf, missingFileMessage, MissingFileError } from "../public/js/files.js";

test("file su un altro dispositivo: messaggio che dice che cosa fare, non un errore tecnico", () => {
  const msg = missingFileMessage("Dispense cap. 3");
  assert.match(msg, /^«Dispense cap\. 3» non è in questo browser/);
  assert.match(msg, /Carica di nuovo/);
  assert.match(missingFileMessage(""), /^«Questo file»/);
  const e = new MissingFileError("Esame 2024");
  assert.equal(e.name, "MissingFileError");
  assert.equal(e.message, missingFileMessage("Esame 2024"));
});

test("file su un altro dispositivo: solo i PDF hanno un file da cercare nel browser", () => {
  assert.equal(fileIdOf({ kind: "pdf", fileId: "f1" }), "f1");
  assert.equal(fileIdOf({ kind: "pdf" }), null);
  assert.equal(fileIdOf({ kind: "notes", text: "…" }), null);
  assert.equal(fileIdOf(null), null);
});
