export default async function handler(req, res) {
    const modeFromQuery = req.query.mode;
    const mode = modeFromQuery === "ip" ? "ip" : "cookie";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    const host = req.headers.host;
    const baseUrl = `https://${host}`;

    res.end(JSON.stringify({
        id: "tb7-premium",
        version: "1.0.0",
        name: "TB7 Premium",
        description: "Profesjonalny dodatek TB7 z trwałym logowaniem i trybem cookie/IP.",
        logo: `${baseUrl}/logo.png`,
        contactEmail: "twoj-email@domena.pl",

        resources: [
            {
                name: "stream",
                types: ["movie", "series"]
            }
        ],

        types: ["movie", "series"],
        idPrefixes: ["tt"],

        catalogs: [
            {
                type: "movie",
                id: "tb7-premium-catalog",
                name: "TB7 Premium",
                extraSupported: ["search"]
            }
        ],

        behaviorHints: {
            configurable: true,
            configurationRequired: true
        },

        // bieżący tryb (z URL) – purely informacyjnie
        config: {
            mode
        }
    }));
}
