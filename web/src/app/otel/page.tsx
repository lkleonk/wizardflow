import type { Metadata } from "next";
import { Suspense } from "react";
import OtelApp from "@/components/otel/OtelApp";

export const metadata: Metadata = {
  title: "OTel dashboard",
  // Only meaningful under `wizardflow serve`; keep it out of search results.
  robots: { index: false, follow: false },
};

// OtelApp reads the query string with useSearchParams, which bails a
// statically exported page out to client rendering up to the nearest
// Suspense boundary; without one, `next build` fails.
export default function OtelPage() {
  return (
    <Suspense fallback={null}>
      <OtelApp />
    </Suspense>
  );
}
