export default function handler(req, res) {
  res.status(200).json({
    id: "tb7-premium",
    version: "1.0.0",
    name: "TB7 Premium",
    description: "Premium addon for TB7",
    logo: "https://tb7-premium.vercel.app/logo.png",

    // Kluczowe!
    resources: ["catalog", "stream"],
    types: ["movie", "series"],

    // Kluczowe! Informuje Stremio, że obsługujesz IMDb
    idPrefixes: ["tt"],

    catalogs: [
      {
        type: "movie",
        id: "tb7-movie",
        name: "TB7 Premium Movies"
      },
      {
        type: "series",
        id: "tb7-series",
        name: "TB7 Premium Series"
      }
    ],

    behaviorHints: {
      configurable: false,
      configurationRequired: false
    }
  });
}
