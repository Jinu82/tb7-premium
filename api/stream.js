import axios from "axios";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";

const TB7 = "https://tb7.pl";
const TMDB = process.env.TMDB_API_KEY;

// Pobranie tytułu PL z TMDb
async function getTitle(imdb) {
  try {
    const r = await axios.get(`https://api.themoviedb.org/3/find/${imdb}`, {
      params: {
        api_key: TMDB,
        language: "pl-PL",
        external_source: "imdb_id",
      },
    });

    const m = r.data.movie_results?.[0];
    if (!m) return null;

    return {
      title: m.title || m.original_title,
      year: m.release_date?.split("-")[0] || null,
    };
  } catch {
    return null;
  }
}

// Logowanie do TB7
async function login() {
  const cfg = await kv.hgetall("tb7:config");
  if (!cfg?.login || !cfg?.password) throw new Error("Brak loginu TB7");

  const cached = await kv.get("tb7:cookie");
  if (cached) return cached;

  const r = await axios.post(
    `${TB7}/zaloguj`,
    new URLSearchParams({ login: cfg.login, haslo: cfg.password }),
    {
      maxRedirects: 0,
      validateStatus: (s) => s === 200 || s === 302,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const set = r.headers["set-cookie"];
  if (!set) throw new Error("Brak cookie TB7");

  const cookie = set.map((c) => c.split(";")[0]).join("; ");
  await kv.set("tb7:cookie", cookie, { ex: 6 * 60 * 60 });

  return cookie;
}

// Szukanie filmu — POPRAWNA WERSJA
async function searchTB7(title, cookie) {
  const r = await axios.post(
    `${TB7}/mojekonto/szukaj`,
    new URLSearchParams({ search: title, type: "1" }),
    {
      headers: {
        Cookie: cookie,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const $ = cheerio.load(r.data);
  const results = [];

  $("table.list tr").each((i, row) => {
    const link = $(row).find('input[name="search[]"]').attr("value");
    const hosting = $(row).find("td").eq(1).text().trim();
    const name = $(row).find("td").eq(2).text().trim();
    const size = $(row).find("td").eq(3).text().trim();

    if (link && name) {
      results.push({ link, hosting, name, size });
    }
  });

  return results;
}

// Pobranie linków z /mojekonto/sciagaj
async function getDirectLinks(link, cookie) {
  const r = await axios.post(
    `${TB7}/mojekonto/sciagaj`,
    new URLSearchParams({ content: link, step: "1" }),
    {
      headers: {
        Cookie: cookie,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const $ = cheerio.load(r.data);
  const text = $("textarea").text().trim();

  if (!text) return [];

  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5);
}

export default async function handler(req, res) {
  try {
    const { id } = req.query;
    if (!id) return res.status(200).json({ streams: [] });

    let title = id;

    if (id.startsWith("tt")) {
      const t = await getTitle(id);
      if (t) title = t.title;
    }

    const cookie = await login();
    const results = await searchTB7(title, cookie);

    if (!results.length) {
      return res.status(200).json({ streams: [] });
    }

    const direct = await getDirectLinks(results[0].link, cookie);

    return res.status(200).json({
      streams: direct.map((url) => ({
        name: "TB7 Premium",
        title: results[0].name,
        url,
      })),
    });
  } catch (e) {
    return res.status(500).json({ streams: [], error: e.message });
  }
}
