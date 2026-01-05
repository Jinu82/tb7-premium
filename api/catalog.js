import axios from "axios";
import cheerio from "cheerio";
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    const { type, search } = req.query;

    // Stremio wymaga pola "metas"
    let metas = [];

    // identyfikacja użytkownika
    const uid = getUID(req, res);
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

    // pobranie konfiguracji użytkownika
    const config = (await kv.hgetall(`tb7:${uid}`)) || {};
    const login = config.login || "";
    const password = config.password || "";
    const mode = config.mode === "ip" ? "ip" : "cookie";

    if (!login || !password) {
        return res.end(JSON.stringify({ metas: [] }));
    }

    const userKey = mode === "ip" ? `tb7-user-ip:${ip}` : `tb7:${uid}`;
    let userData = (await kv.hgetall(userKey)) || {};

    if (!userData.login) {
        userData.login = login;
        userData.password = password;
        await kv.hset(userKey, userData);
    }

    if (!userData.cookie) {
        const cookie = await loginTB7(userData.login, userData.password);
        if (!cookie) return res.end(JSON.stringify({ metas: [] }));
        userData.cookie = cookie;
        await kv.hset(userKey, userData);
    }

    try {
        // jeśli użytkownik wpisuje wyszukiwanie
        if (search) {
            metas = await searchTB7(search, userData.cookie);
        } else {
            // katalog główny — pobieramy listę najnowszych filmów
            metas = await latestTB7(userData.cookie);
        }
    } catch (e) {
        metas = [];
    }

    res.end(JSON.stringify({ metas }));
}

/* ------------------ FUNKCJE POMOCNICZE ------------------ */

async function loginTB7(login, password) {
    try {
        const res = await axios.post(
            "https://tb7.pl/logowanie",
            new URLSearchParams({ login, password }),
            { maxRedirects: 5 }
        );

        const cookie = res.headers["set-cookie"]?.join("; ");
        return cookie || null;
    } catch {
        return null;
    }
}

async function searchTB7(query, cookie) {
    const url = `https://tb7.pl/mojekonto/szukaj?q=${encodeURIComponent(query)}`;
    const res = await axios.get(url, {
        headers: { Cookie: cookie },
        maxRedirects: 5
    });

    const $ = cheerio.load(res.data);
    const results = $("a[href*='/mojekonto/pobierz/']");

    const metas = [];

    results.each((i, el) => {
        const name = $(el).text().trim();
        const imdb = extractIMDB(name);

        metas.push({
            id: imdb || `tb7-${i}`,
            type: "movie",
            name
        });
    });

    return metas;
}

async function latestTB7(cookie) {
    const res = await axios.get("https://tb7.pl/mojekonto", {
        headers: { Cookie: cookie },
        maxRedirects: 5
    });

    const $ = cheerio.load(res.data);
    const results = $("a[href*='/mojekonto/pobierz/']");

    const metas = [];

    results.each((i, el) => {
        const name = $(el).text().trim();
        const imdb = extractIMDB(name);

        metas.push({
            id: imdb || `tb7-${i}`,
            type: "movie",
            name
        });
    });

    return metas;
}

function extractIMDB(text) {
    const match = text.match(/tt\d+/);
    return match ? match[0] : null;
}

function getUID(req, res) {
    const cookieHeader = req.headers.cookie || "";
    const cookies = Object.fromEntries(
        cookieHeader
            .split(";")
            .map(c => c.trim())
            .filter(Boolean)
            .map(c => {
                const [k, ...rest] = c.split("=");
                return [k, rest.join("=")];
            })
    );

    if (cookies.tb7uid) return cookies.tb7uid;

    const uid = Math.random().toString(36).substring(2);
    const existingSetCookie = res.getHeader("Set-Cookie");
    const newCookie = `tb7uid=${uid}; Path=/; Max-Age=31536000; SameSite=Lax`;
    if (existingSetCookie) {
        res.setHeader("Set-Cookie", [].concat(existingSetCookie, newCookie));
    } else {
        res.setHeader("Set-Cookie", newCookie);
    }
    return uid;
}
