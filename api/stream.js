import axios from "axios";
import * as cheerio from "cheerio";
import qs from "qs";
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    const { type, id } = req.query;
    if (!type || !id) {
        res.end(JSON.stringify({ streams: [] }));
        return;
    }

    const uidCookie = getUID(req, res);
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

    // odczyt konfiguracji użytkownika
    const config = (await kv.hgetall(`tb7:${uidCookie}`)) || {};
    const login = config.login || "";
    const password = config.password || "";
    const mode = config.mode === "ip" ? "ip" : "cookie";

    if (!login || !password) {
        res.end(JSON.stringify({ streams: [] }));
        return;
    }

    const userKey = mode === "ip" ? `tb7-user-ip:${ip}` : `tb7:${uidCookie}`;

    let userData = (await kv.hgetall(userKey)) || {};
    if (!userData.login) {
        userData.login = login;
        userData.password = password;
        await kv.hset(userKey, userData);
    }

    if (!userData.cookie) {
        const cookie = await loginTB7(userData.login, userData.password);
        if (!cookie) {
            res.end(JSON.stringify({ streams: [] }));
            return;
        }
        userData.cookie = cookie;
        await kv.hset(userKey, userData);
    }

    const imdbId = id.split(":")[0];
    let title = imdbId;

    try {
        const meta = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        if (meta.data && meta.data.meta && meta.data.meta.name) {
            title = meta.data.meta.name;
        }
    } catch {
        // brak meta – używamy imdbId
    }

    try {
        const clean = title.replace(/[^a-zA-Z0-9 ]/g, "");
        const searchUrl = `https://tb7.pl/mojekonto/szukaj?q=${encodeURIComponent(clean)}`;

        const searchRes = await axios.get(searchUrl, {
            headers: { Cookie: userData.cookie },
            maxRedirects: 5
        });

        const $ = cheerio.load(searchRes.data);
        const results = $("a[href*='/mojekonto/pobierz/']");

        if (results.length === 0) {
            res.end(JSON.stringify({ streams: [] }));
            return;
        }

        const first = results.first();
        const fileName = first.text().trim() || title;
        const prepareUrl = first.attr("href");

        if (!prepareUrl) {
            res.end(JSON.stringify({ streams: [] }));
            return;
        }

        const step2 = await axios.get(
            prepareUrl.startsWith("http") ? prepareUrl : `https://tb7.pl${prepareUrl}`,
            {
                headers: { Cookie: userData.cookie },
                maxRedirects: 5
            }
        );

        const $2 = cheerio.load(step2.data);
        const form = $2("form");
        const formAction = form.attr("action") || "/mojekonto/sciagaj";

        const step3 = await axios.post(
            formAction.startsWith("http") ? formAction : `https://tb7.pl${formAction}`,
            qs.stringify({ wgraj: "Wgraj linki" }),
            {
                headers: {
                    Cookie: userData.cookie,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                maxRedirects: 5
            }
        );

        const $3 = cheerio.load(step3.data);
        const finalLink = $3("a[href*='/sciagaj/']").first().attr("href");

        if (!finalLink) {
            res.end(JSON.stringify({ streams: [] }));
            return;
        }

        const streamUrl = finalLink.startsWith("http")
            ? finalLink
            : `https://tb7.pl${finalLink}`;

        res.end(JSON.stringify({
            streams: [
                {
                    name: "TB7 Premium",
                    title: fileName,
                    url: streamUrl
                }
            ]
        }));
    } catch (e) {
        res.end(JSON.stringify({ streams: [] }));
    }
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
