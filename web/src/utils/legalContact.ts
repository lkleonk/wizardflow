// Provider contact details for the Impressum / Datenschutz pages.
//
// German law (Impressum) requires real provider details on the live site, but
// they are personal data that must not live in a public repository. So the real
// address and email are injected at build time via NEXT_PUBLIC_* env vars on the
// hosted deployment (e.g. Vercel); the committed source carries only
// placeholders. See web/.env.example.
export const legalContact = {
  name: process.env.NEXT_PUBLIC_LEGAL_NAME ?? "Leon Koch",
  street: process.env.NEXT_PUBLIC_LEGAL_STREET ?? "Straße & Hausnummer",
  cityLine: process.env.NEXT_PUBLIC_LEGAL_CITY ?? "PLZ Ort",
  country: process.env.NEXT_PUBLIC_LEGAL_COUNTRY ?? "Deutschland",
  email: process.env.NEXT_PUBLIC_LEGAL_EMAIL ?? "kontakt@getwizardflow.com",
};
