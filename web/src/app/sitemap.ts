import type { MetadataRoute } from "next";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";

// Generated as a static file at build — required for `output: "export"`.
export const dynamic = "force-static";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://getwizardflow.com";

// Static, hand-maintained sitemap. The hosted website includes legal pages;
// the local SDK UI keeps only the replay viewer and project link.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const routes: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified, changeFrequency: "monthly", priority: 1 },
  ];

  if (isHostedWizardFlow) {
    routes.push(
      {
        url: `${siteUrl}/impressum`,
        lastModified,
        changeFrequency: "yearly",
        priority: 0.3,
      },
      {
        url: `${siteUrl}/datenschutz`,
        lastModified,
        changeFrequency: "yearly",
        priority: 0.3,
      }
    );
  }

  return routes;
}
