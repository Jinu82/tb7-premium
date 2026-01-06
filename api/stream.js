import axios from "axios";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";

const TB7_BASE_URL = "https://tb7.pl";
const TMDB_KEY = process.env.TMDB_API_KEY;

function stripPolishChars(text) {
  return text
    .replace(/ą/g, "a")
    .replace(/ć/g, "c")
    .replace(/ę/g, "e")
    .replace(/ł/g, "l")
    .replace(/ń/g, "n")
    .replace(/ó/g, "o")
    .replace(/ś/g, "s")
    .replace(/ź/g, "z")
    .replace(/ż/g, "z");
}

async function getTMDbTitle(imdbId) {
  console.log("🔍 TMDb lookup for:", imdbId);
  if (!TMDB_KEY) return null;

  try {
    const res = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
      params: {
        api_key: TMDB_KEY,
        language: "pl-PL",
        external_source: "imdb_id",
      },
    });

    const movie = res.data.movie_results?.[0];
    if (!movie) return null;

    return {
      title: movie.title || movie.original_title,
      original: movie.original_title,
      year: movie.release_date?.split("-")[0] || null,
    };
  } catch {
    return null;
  }
}

async function loginTB7() {
  const config = (await kv.hgetall("tb7:config")) || {};
  const login = config.login;
  const password = config.password;

  if (!login || !password) throw new Error("Brak loginu/hasła TB7");

  const cachedCookie = await kv.get("tb7:sessionCookie");
  if (cachedCookie) return cachedCookie;

  const res = await axios.post(
    `${TB7_BASE_URL}/zaloguj`,
    new URLSearchParams({ login, haslo: password }),
    {
      maxRedirects: 0,
      validateStatus: (s) => s === 302 || s === 200 || s === 301,
    }
  );

  const setCookie = res.headers["set-cookie"];
  if (!setCookie || !setCookie.length) throw new Error("TB7 nie zwrócił cookie");

  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  await kv.set("tb7:sessionCookie", cookie, { ex: 6 * 60 * 60 });
  return cookie;
}

async function searchTB7(title, year, cookie) {
  console.log("🔎 Szukam na TB7:", title, year);
  const res = await axios.post(
    `${TB7_BASE_URL}/mojekonto/szukaj`,
    new URLSearchParams({ search: title, type: "1" }),
    {
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const $ = cheerio.load(res.data);
  const results = [];

  $(".btn-1").each((i, el) => {
    const parent = $(el).closest("form");
    const content = parent.find("input[name='content']").attr("value");
    const name = content?.split("/").pop();

    if (!content || !name) return;

    const nameLower = name.toLowerCase();
    const titleLower = title.toLowerCase();

    if (!nameLower.includes(titleLower)) return;
    if (year && !nameLower.includes(year)) return;

    results.push({
      name,
      url: `${TB7_BASE_URL}/mojekonto/szukaj`,
    });
  });

  console.log("✅ Wyniki TB7:", results.length);
  return results;
}

export default async function handler(req, res) {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ streams: [] });

    let title = id;
    let year = null;

    if (id.startsWith("tt")) {
      const tmdb = await getTMDbTitle(id);
      if (tmdb) {
        title = tmdb.title;
        year = tmdb.year;
      }
    }

    const cookie = await loginTB7();

    const attempts = [
      { label: "Polski tytuł", value: title },
      { label: "Oryginalny tytuł", value: stripPolishChars(title) },
      { label: "IMDb ID", value: id },
    ];

    for (const attempt of attempts) {
      console.log(`🟡 Próba: ${attempt.label} → ${attempt.value}`);
      const results = await searchTB7(attempt.value, year, cookie);
      if (results.length) {
        console.log("🟢 Trafione:", attempt.label);
        return res.status(200).json({
          streams: results.map((r) => ({
            name: "TB7 Premium",
            title: r.name,
            url: r.url,
          })),
        });
      }
    }

    console.log("🔴 Brak wyników po wszystkich próbach");
    return res.status(200).json({ streams: [] });
  } catch (err) {
    console.log("❌ Błąd stream.js:", err.message);
    return res.status(500).json({ streams: [], error: err.message });
  }
}
