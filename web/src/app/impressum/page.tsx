import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ObfuscatedEmail } from "@/components/ObfuscatedEmail";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import { legalContact } from "@/utils/legalContact";
import styles from "../legalPage.module.css";

export const metadata: Metadata = {
  title: "Impressum | WizardFlow",
  description: "Legal provider information for WizardFlow.",
};

export default function ImpressumPage() {
  if (!isHostedWizardFlow) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.backLink} href="/">
          Back to WizardFlow
        </Link>

        <p className={styles.eyebrow}>Legal</p>
        <h1 className={styles.title}>Impressum</h1>
        <p className={styles.lead}>
          Angaben gemaess § 5 Digitale-Dienste-Gesetz (DDG) und § 18
          Medienstaatsvertrag (MStV).
        </p>

        <section className={styles.section}>
          <h2>Anbieter</h2>
          <address className={styles.address}>
            {legalContact.name}
            <br />
            {legalContact.street}
            <br />
            {legalContact.cityLine}
            <br />
            {legalContact.country}
          </address>
        </section>

        <section className={styles.section}>
          <h2>Kontakt</h2>
          <p>
            E-Mail:{" "}
            <ObfuscatedEmail
              className={styles.inlineLink}
              email={legalContact.email}
            />
          </p>
        </section>

        <section className={styles.section}>
          <h2>Online-Profil</h2>
          <p>
            GitHub:{" "}
            <a
              className={styles.inlineLink}
              href="https://github.com/lkleonk"
              rel="noreferrer"
              target="_blank"
            >
              @lkleonk
            </a>
          </p>
        </section>

        <section className={styles.section}>
          <h2>Verantwortlich fuer den Inhalt</h2>
          <address className={styles.address}>
            {legalContact.name}
            <br />
            {legalContact.street}
            <br />
            {legalContact.cityLine}
            <br />
            {legalContact.country}
          </address>
        </section>
      </div>
    </main>
  );
}
