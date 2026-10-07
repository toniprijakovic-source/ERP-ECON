import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const demo = loadEnv(mode, process.cwd(), "VITE_").VITE_DEMO === "1" || process.env.VITE_DEMO === "1";
  return {
    plugins: [
      react(),
      // Demo build: naslov kartice bez naziva tvrtke.
      { name: "naslov-stranice", transformIndexHtml: (html) => (demo ? html.replace(/<title>.*<\/title>/, "<title>ERP · Demo</title>") : html) },
    ],
    resolve: {
      // Demo build ne smije sadržavati Econ logotip ni kao datoteku — zamjenjuje se praznom slikom
      // (App.jsx ga u demu ionako ne prikazuje, vidi LogoTvrtke).
      alias: demo ? [{ find: /^\.\/assets\/logo-econ\.jpg$/, replacement: fileURLToPath(new URL("./src/assets/prazno.svg", import.meta.url)) }] : [],
    },
    server: {
      port: 5173,
    },
  };
});
