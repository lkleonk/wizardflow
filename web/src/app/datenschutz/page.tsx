import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ObfuscatedEmail } from "@/components/ObfuscatedEmail";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import { legalContact } from "@/utils/legalContact";
import styles from "../legalPage.module.css";

export const metadata: Metadata = {
  title: "Datenschutzerklärung | WizardFlow",
  description: "Privacy information for WizardFlow.",
};

export default function DatenschutzPage() {
  if (!isHostedWizardFlow) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.backLink} href="/">
          Back to WizardFlow
        </Link>

        <p className={styles.eyebrow}>Privacy</p>
        <h1 className={styles.title}>Datenschutzerklärung</h1>
        <p className={styles.lead}>
          Diese Datenschutzerklaerung informiert ueber die Verarbeitung
          personenbezogener Daten beim Besuch von WizardFlow. Stand: 4. Juni
          2026.
        </p>

        <section className={styles.section}>
          <h2>Verantwortlicher</h2>
          <address className={styles.address}>
            {legalContact.name}
            <br />
            {legalContact.street}
            <br />
            {legalContact.cityLine}
            <br />
            {legalContact.country}
          </address>
          <p>
            E-Mail:{" "}
            <ObfuscatedEmail
              className={styles.inlineLink}
              email={legalContact.email}
            />
          </p>
        </section>

        <section className={styles.section}>
          <h2>Hosting und Zugriffsdaten</h2>
          <p>
            Beim Aufruf dieser Website verarbeitet der jeweilige Hosting-Anbieter
            technisch notwendige Zugriffsdaten, damit die Website ausgeliefert
            werden kann. Dazu koennen insbesondere IP-Adresse, Datum und Uhrzeit
            des Zugriffs, angeforderte Dateien, Referrer, Browser- und
            Betriebssysteminformationen sowie Server-Logdaten gehoeren.
          </p>
          <p>
            Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte
            Interesse liegt im sicheren und stabilen Betrieb der Website.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Upload von JSON-Dateien</h2>
          <p>
            WizardFlow liest hochgeladene JSON-Dateien lokal im Browser.
            Nach aktuellem Stand werden diese Dateien durch die App nicht an
            einen Server uebertragen und nicht serverseitig gespeichert.
          </p>
          <p>
            Damit ein versehentliches Neuladen der Seite die Ansicht nicht
            verwirft, wird die zuletzt hochgeladene Datei voruebergehend im
            sessionStorage des Browsers gehalten. Dieser Speicher ist auf den
            aktuellen Browser-Tab beschraenkt und wird beim Schliessen des Tabs
            automatisch geloescht.
          </p>
          <p>
            Wenn eine hochgeladene Datei personenbezogene Daten enthaelt, werden diese
            beim Anzeigen der Datei lokal in Ihrem Browser verarbeitet.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Cookies, Analytics und Tracking</h2>
          <p>
            WizardFlow setzt nach aktuellem Stand keine eigenen Cookies ein und
            verwendet keine Analytics- oder Tracking-Dienste.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Externe Links</h2>
          <p>
            Die Website kann auf externe Angebote verlinken, insbesondere auf
            das GitHub-Profil{" "}
            <a
              className={styles.inlineLink}
              href="https://github.com/lkleonk"
              rel="noreferrer"
              target="_blank"
            >
              @lkleonk
            </a>
            . Beim Anklicken externer Links gelten die Datenschutzbestimmungen
            des jeweiligen Anbieters.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Rechte betroffener Personen</h2>
          <p>
            Sie haben im Rahmen der gesetzlichen Voraussetzungen insbesondere
            Rechte auf Auskunft, Berichtigung, Loeschung, Einschraenkung der
            Verarbeitung, Datenuebertragbarkeit und Widerspruch. Ausserdem
            besteht ein Beschwerderecht bei einer Datenschutzaufsichtsbehoerde.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Hinweis</h2>
          <p>
            Pruefe vor dem Deployment, welcher Hosting-Anbieter tatsaechlich
            verwendet wird und ob dessen konkrete Datenverarbeitung ergaenzt
            werden muss.
          </p>
        </section>
      </div>
    </main>
  );
}
