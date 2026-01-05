import axios from "axios";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";

const TB7_BASE_URL = "https://tb7.pl";
const TMDB_KEY = process.env.TMDB_API_KEY;

async function getPolishTitle(imdbId) {
  console.log("🔍 TMDb lookup for:", imdbId);
  if (!TMDB_KEY) {
    console.log("❌ Brak TMDB_API_KEY");
    return null;
  }

  try {
    const res = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
      params: {
        api_key: TMDB_KEY,
        language: "pl-PL",
        external_source: "imdb_id",
      },
    });

    const movie = res.data.movie_results?.[0];
    if (!movie) {
      console.log("❌ TMDb nie zwrócił filmu");
      return null;
    }

    console.log("✅ TMDb zwrócił:", movie.title, movie.release_date);
    return {
      title: movie.title || movie.original_title,
      year: movie.release_date?.split("-")[0] || null,
    };
  } catch (err) {
    console.log("❌ Błąd TMDb:", err.message);
    return null;
  }
}

async function loginTB7() {
  console.log("🔐 Logowanie do TB7...");
  const config = (await kv.hgetall("tb7:config")) || {};
  const login = config.login;
  const password = config.password;

  if (!login || !password) {
    console.log("❌ Brak loginu/hasła TB7");
    throw new Error("Brak loginu/hasła TB7");
  }

  const cachedCookie = await kv.get("tb7:sessionCookie");
  if (cachedCookie) {
    console.log("✅ Użyto cache cookie TB7");
    return cachedCookie;
  }

  const res = await axios.post(
    `${TB7_BASE_URL}/zaloguj`,
    new URLSearchParams({ login, haslo: password }),
    {
      maxRedirects: 0,
      validateStatus: (s) => s === 302 || s === 200 || s === 301,
    }
  );

  const setCookie = res.headers["set-cookie"];
  if (!setCookie || !setCookie.length) {
    console.log("❌ TB7 nie zwrócił cookie");
    throw new Error("TB7 nie zwrócił cookie");
  }

  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  await kv.set("tb7:sessionCookie", cookie, { ex: 6 * 60 * 60 });
  console.log("✅ Zalogowano do TB7");
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
    if (!id) {
      console.log("❌ Brak ID");
      return res.status(400).json({ streams: [] });
    }

    let title = null;
    let year = null;

    if (id.startsWith("tt")) {
      const tmdb = await getPolishTitle(id);
      if (tmdb) {
        title = tmdb.title;
        year = tmdb.year;
      } else {
        title = id;
      }
    } else {
      title = id;
    }

    console.log("🎬 Tytuł do wyszukania:", title, year);

    const cookie = await loginTB7();
    const results = await searchTB7(title, year, cookie);

    if (!results.length) {
      console.log("⚠️ Brak wyników TB7");
    }

    return res.status(200).json({
      streams: results.map((r) => ({
        name: "TB7 Premium",
        title: r.name,
        url: r.url,
      })),
    });
  } catch (err) {
    console.log("❌ Błąd stream.js:", err.message);
    return res.status(500).json({ streams: [], error: err.message });
  }
}
