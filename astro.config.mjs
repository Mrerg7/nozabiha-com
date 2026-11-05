import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://nozabiha.com",
  output: "static",
  trailingSlash: "always",
  integrations: [sitemap()],
});
