import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://calisthenics.ru";
  const lastModified = new Date();
  return [
    { url: `${base}/`, lastModified },
    { url: `${base}/online`, lastModified },
    { url: `${base}/schedule`, lastModified },
    { url: `${base}/handstand_online`, lastModified },
    { url: `${base}/project`, lastModified },
    { url: `${base}/payment`, lastModified },
    { url: `${base}/pdp`, lastModified },
  ];
}

