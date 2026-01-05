export default function handler(req, res) {
  res.status(200).json({
    id: "tb7-premium",
    version: "1.0.0",
    name: "TB7 Premium",
    description: "Premium addon for TB7",
    logo: "https://tb7-premium.vercel.app/logo.png",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    catalogs: [
      {
        type: "movie",
        id: "tb7-movie-catalog",
        name: "TB7 Premium Movies"
      },
      {
        type: "series",
        id: "tb7-series-catalog",
        name: "TB7 Premium Series"
      }
    ]
  });
}
