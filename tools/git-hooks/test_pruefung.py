"""Tests der Commit-Prüfung: python3 -m unittest tools/git-hooks/test_pruefung.py

Alle Testwerte sind erfunden und werden zur Laufzeit zusammengesetzt, damit sie im Quelltext nicht selbst als Fund gelten.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest
import datetime as dt

HIER = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pruefung", HIER / "pruefung.py")
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)

SALZ = "testsalz"
GEHEIM = "Kx7" + "qP2vL9" + "zR4tW1"
NAME = "Hilde" + "gard"
MAILADR = "hilde" + "gard@" + "beispielhof.org"
TAG_LANG = "CH113" + "99990012" + "7"
BETRAG_ECHT = "61234" + ".55"
BETRIEB = "BEB" + "999123"


def iban() -> str:
    rumpf = "00762" + "011623852957"
    pruef = 98 - int("".join(str(int(c, 36)) for c in rumpf + "CH00")) % 97
    return f"CH{pruef:02d}{rumpf}"


def ahv() -> str:
    z = "756" + "123456789"
    d = [int(c) for c in z]
    p = (10 - sum(c * (3 if i % 2 else 1) for i, c in enumerate(d)) % 10) % 10
    return f"{z[:3]}.{z[3:7]}.{z[7:11]}.{z[11:]}{p}"


def h(w: str) -> str:
    return hashlib.sha256(f"{SALZ}:{w}".encode()).hexdigest()[:32]


def werte_json() -> dict:
    return {
        "salz": SALZ, "erstellt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "geheim": {str(len(GEHEIM)): [h(GEHEIM)]}, "phrasen": {}, "nummern": {str(len(BETRIEB)): [h(BETRIEB)]},
        "woerter": [h(NAME), h(NAME.upper())], "mails": [h(MAILADR)], "ohrmarken": [h(P.ohrmarke_kern(TAG_LANG))], "betraege": [h(BETRAG_ECHT)],
    }


class Muster(unittest.TestCase):
    def treffer(self, zeile: str) -> list[str]:
        return P.muster_arten(zeile)

    def test_bekannte_tokens(self):
        for wert in ("gh" + "p_" + "aB3" * 12, "sk-" + "ant-" + "aB3-" * 8, "AK" + "IA" + "ABCDEFGH23456789", "xo" + "xb-" + "12345678-abcdefgh"):
            self.assertIn("Zugangstoken", self.treffer(f"wert {wert} ende"), wert[:6])

    def test_privater_schluessel_und_jwt(self):
        self.assertIn("privater Schlüssel", self.treffer("-----BEGIN " + "RSA PRIVATE KEY-----"))
        jwt = "eyJ" + "hbGciOiJIUzI1" + ".eyJ" + "zdWIiOiIxMjM0" + ".abcDEF123456"
        self.assertIn("JWT", self.treffer(jwt))

    def test_passwort_in_url(self):
        self.assertIn("Passwort in URL", self.treffer("postgres://nutzer:" + "s3cret99" + "@db.intern:5432/x"))
        self.assertEqual(self.treffer("postgres://nutzer:${DB_PASS}@db/x"), [])

    def test_klartext_zuweisung(self):
        self.assertIn("Passwort oder Schlüssel im Klartext", self.treffer('api_key = "' + "Zq8xLm2Pw7Rt" + '"'))
        self.assertIn("Wert in Konfiguration", self.treffer("  DB_PASSWORD: " + "Zq8xLm2Pw7Rt"))

    def test_kein_fehlalarm_im_code(self):
        for zeile in ("const token = getToken()", "password: body.password,", "token: str", 'token: "test-token-1234"', "POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}",
                      "const id = '11111111-2222-4333-8444-555555555555'", "// Die Kurzform CH" + "99990012 ohne Punkte", "function veryLongFunctionNameThatGoesOnAndOnAndOnForever() {}"):
            self.assertEqual([a for a in self.treffer(zeile) if a != "Mailadresse"], [], zeile)

    def test_wert_in_konfiguration_nur_dort(self):
        zeile = "  API_TOKEN: " + "Zq8xLm2Pw7Rt"
        for pfad, erwartet in (("docker-compose.yml", True), ("a/.env.example", True), ("src/a.ts", False)):
            p = P.Pruefer(P.Werte(werte_json(), set(), set()), set())
            p.zeile(f"{pfad}:1", pfad, zeile)
            self.assertEqual(bool(p.funde), erwartet, pfad)

    def test_iban_und_ahv_mit_pruefziffer(self):
        self.assertIn("IBAN", self.treffer(f"Konto {iban()}"))
        self.assertNotIn("IBAN", self.treffer("Konto CH00" + "00762011623852957"))
        self.assertIn("AHV-Nummer", self.treffer(f"AHV {ahv()}"))

    def test_mailadressen(self):
        self.assertIn("Mailadresse", self.treffer("kontakt " + "jemand@" + "firma-z.com"))
        self.assertEqual(self.treffer("a@example.com, fmis@riedackerhof.ch, test@beispiel.ch"), [])

    def test_zufallswert(self):
        self.assertIn("Zufallswert, könnte ein Schlüssel sein", self.treffer("x = " + "Ab3dE9gH2jK7mN4p" + "Q8sT1vW6yZ0bC5fG"))
        self.assertIn("Zufallswert, könnte ein Schlüssel sein", self.treffer("key " + "9f8e7d6c5b4a39281706" + "f5e4d3c2b1a09f8e7d6c"))
        self.assertEqual(self.treffer("integrity sha512-" + "Ab3dE9gH2jK7mN4p" + "Q8sT1vW6yZ0bC5fG"), [])


class Pfade(unittest.TestCase):
    def test_verboten(self):
        for pfad in (".env", ".env.prod", "x/.env", "secrets/a", "a/id_ed25519", "c.pem", "a.pdf", "b.xlsx", "d.csv", "e.sql.gz", "backups/x", "docs/review/a.md", "input/a", "docker-compose.override.yml", "b123.K11", ".netrc", "uploads/x"):
            self.assertTrue(P.pfad_arten(pfad), pfad)

    def test_erlaubt(self):
        for pfad in (".env.example", "input/.gitkeep", "src/a.ts", "modules/x/schema/0001.sql", "docker-compose.yml", "logo.png"):
            self.assertEqual(P.pfad_arten(pfad), [], pfad)

    def test_binaer_und_groesse(self):
        self.assertTrue(P.pfad_arten("a.bin", True))
        self.assertEqual(P.pfad_arten("a.png", True), [])
        self.assertTrue(P.pfad_arten("a.ts", False, P.MAX_BYTES + 1))


class EchteWerte(unittest.TestCase):
    def setUp(self):
        self.w = P.Werte(werte_json(), set(), set())

    def test_geheimnis_auch_mitten_in_einer_zeile(self):
        self.assertIn("Geheimnis aus .env oder secrets/", self.w.arten(f'url="x{GEHEIM}y"'))

    def test_name_nur_in_schreibweise_des_namens(self):
        self.assertIn("Personendaten", self.w.arten(f"person: '{NAME}'"))
        self.assertIn("Personendaten", self.w.arten(f"person: '{NAME.upper()}'"))
        self.assertEqual(self.w.arten(f"const {NAME.lower()} = 1"), [])

    def test_eigener_name_ist_erlaubt(self):
        self.assertEqual(P.Werte(werte_json(), set(), {NAME, MAILADR}).arten(f"{NAME} {MAILADR}"), [])

    def test_mail(self):
        self.assertIn("Personendaten: Mailadresse", self.w.arten(MAILADR))

    def test_ohrmarke_in_allen_schreibweisen(self):
        kern = P.ohrmarke_kern(TAG_LANG)
        for form in (TAG_LANG, f"CH{kern}", f"{kern[:4]}.{kern[4:]}", f"CH {kern[:4]} {kern[4:]}"):
            self.assertIn("echte Ohrmarke", self.w.arten(f"tier {form} ende"), form)
        self.assertEqual(self.w.arten("tier CH11100000000 ende"), [])

    def test_betrag(self):
        self.assertIn("echter Betrag", self.w.arten("Total 61'234" + ".55 Fr."))
        self.assertIn("echter Betrag", self.w.arten(f"amount: {BETRAG_ECHT}"))
        self.assertEqual(self.w.arten("amount: 61234.56"), [])

    def test_betriebsnummer(self):
        self.assertIn("echte Betriebsnummer", self.w.arten(f"nr {BETRIEB}"))

    def test_env_zeilen(self):
        self.assertEqual(P.aus_env_zeile("JWT_SECRET=Kx7qP2vL9zR4"), ["Kx7qP2vL9zR4"])
        self.assertEqual(P.aus_env_zeile("VAPID_PUBLIC_KEY=Kx7qP2vL9zR4"), [])
        self.assertEqual(P.aus_env_zeile("DOMAIN=fmis.beispiel.ch"), [])
        self.assertEqual(P.aus_env_zeile("POSTGRES_PASSWORD=postgres"), [])
        self.assertIn("geheim12345", P.aus_env_zeile("DATABASE_URL=postgres://u:" + "geheim12345" + "@db/x"))


class ImEchtenRepo(unittest.TestCase):
    """Echte Commits und Pushes in einem Wegwerf-Repo mit den echten Hooks."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        shutil.copytree(HIER, self.repo / "tools/git-hooks", ignore=shutil.ignore_patterns("__pycache__"))
        self.werte = self.tmp / "werte.json"
        self.werte.write_text(json.dumps(werte_json()), encoding="utf-8")
        self.env = {**os.environ, "FMIS_PRUEFUNG_WERTE": str(self.werte), "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null"}
        for a in (["init", "-q", "-b", "main"], ["config", "user.name", "Test"], ["config", "user.email", "t@example.com"], ["config", "core.hooksPath", "tools/git-hooks"]):
            self.git(*a)
        self.git("add", "tools")
        self.assertEqual(self.git("commit", "-qm", "Prüfung").returncode, 0)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def git(self, *a, **k):
        return subprocess.run(["git", *a], cwd=self.repo, env=self.env, capture_output=True, text=True, **k)

    def commit(self, pfad: str, inhalt: str, nachricht: str = "Änderung"):
        (self.repo / pfad).parent.mkdir(parents=True, exist_ok=True)
        (self.repo / pfad).write_text(inhalt, encoding="utf-8")
        self.git("add", "-f", pfad)
        return self.git("commit", "-qm", nachricht)

    def test_sauberer_commit_geht_durch(self):
        self.assertEqual(self.commit("a.ts", "export const a = 1\n").returncode, 0)

    def test_geheimnis_wird_abgelehnt_ohne_den_wert_zu_nennen(self):
        r = self.commit("a.ts", f"const a = 'x{GEHEIM}'\n")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("a.ts:1", r.stderr)
        self.assertNotIn(GEHEIM, r.stderr + r.stdout)

    def test_env_datei_wird_abgelehnt(self):
        self.assertNotEqual(self.commit("sub/.env", "A=1\n").returncode, 0)

    def test_nachricht_wird_geprueft(self):
        r = self.commit("a.ts", "export const a = 1\n", f"Fix für {NAME}")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Commit-Nachricht", r.stderr)

    def test_alte_zeilen_bleiben_nur_neue_zaehlen(self):
        self.assertEqual(self.git("commit", "--allow-empty", "-qm", "leer").returncode, 0)
        self.assertEqual(self.commit("a.ts", f"const n = '{NAME}'\n", "x").returncode, 1)
        self.git("commit", "--no-verify", "-qm", "umgangen")
        self.assertEqual(self.commit("a.ts", f"const n = '{NAME}'\nconst b = 2\n").returncode, 0)

    def test_ausnahme_mit_fingerabdruck(self):
        r = self.commit("a.ts", f"const n = '{NAME}'\n")
        abdruck = r.stderr.split("[")[1].split("]")[0]
        with open(self.repo / "tools/git-hooks/ausnahmen.txt", "a", encoding="utf-8") as f:
            f.write(f"{abdruck} kein Name, sondern ein Wort\n")
        self.assertEqual(self.git("commit", "-qm", "x").returncode, 0)

    def test_ohne_vergleichswerte_wird_abgelehnt(self):
        self.werte.unlink()
        r = self.commit("a.ts", "export const a = 1\n")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Prüfung nicht möglich", r.stderr)

    def test_push_stoppt_umgangenen_commit(self):
        ziel = self.tmp / "ziel.git"
        subprocess.run(["git", "init", "-q", "--bare", str(ziel)], check=True, env=self.env)
        self.git("remote", "add", "origin", str(ziel))
        self.assertEqual(self.git("push", "-q", "origin", "main").returncode, 0)
        (self.repo / "a.ts").write_text(f"const a = '{GEHEIM}'\n", encoding="utf-8")
        self.git("add", "a.ts")
        self.assertEqual(self.git("commit", "--no-verify", "-qm", "umgangen").returncode, 0)
        r = self.git("push", "-q", "origin", "main")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("a.ts:1", r.stderr)
        self.assertNotIn(GEHEIM, r.stderr)

    def test_historie_findet_geloeschtes(self):
        (self.repo / "a.ts").write_text(f"const a = '{GEHEIM}'\n", encoding="utf-8")
        self.git("add", "a.ts")
        self.git("commit", "--no-verify", "-qm", "umgangen")
        self.git("rm", "-qf", "a.ts")
        self.git("commit", "--no-verify", "-qm", "weg")
        r = subprocess.run(["python3", "tools/git-hooks/pruefung.py", "--historie"], cwd=self.repo, env=self.env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("a.ts:1", r.stderr)


if __name__ == "__main__":
    unittest.main()
