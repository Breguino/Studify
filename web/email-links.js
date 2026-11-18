// Link delle email (conferma, recupero password) arrivati sulla home invece che su /app: li inoltra all'app con la sessione.
// File a parte, non scritto nella pagina: la Content-Security-Policy del sito non permette script in linea.
if (/access_token=|error_code=|error=/.test(location.hash)) location.replace("/app" + location.search + location.hash);
