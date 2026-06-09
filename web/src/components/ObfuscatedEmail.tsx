"use client";

import { useEffect, useState } from "react";

type Props = {
  /** Plain address, e.g. "kontakt@getwizardflow.com". */
  email: string;
  className?: string;
};

// Keeps the address out of the statically-exported HTML so naive email
// harvesters that only scan HTML can't read it. The real "@"/"mailto:" string
// is assembled client-side after hydration, so the served .html never contains
// a harvestable address.
//
// Real users get a normal, clickable mailto link once JS runs; the obfuscated
// pre-hydration form (also the <noscript> fallback) stays human-readable so the
// contact remains directly reachable — an Impressum (§5 TMG) requirement.
export function ObfuscatedEmail({ email, className }: Props) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(true);
  }, []);

  if (!revealed) {
    const [user, domain] = email.split("@");
    // No "@" and no "mailto:" → not a valid address for a regex harvester,
    // but trivially readable/typable for a human.
    return (
      <span className={className}>
        {user} [at] {domain?.replace(/\./g, " [dot] ")}
      </span>
    );
  }

  return (
    <a className={className} href={`mailto:${email}`}>
      {email}
    </a>
  );
}
