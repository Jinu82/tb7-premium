import axios from "axios";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";

const TB7_BASE_URL = "https://tb7.pl";

// Pobranie IMDb z OMDb na podstawie tytułu
async function getImdbFromTitle(title) {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await axios.get("https://www.omdbapi.com/", {
      params: {
        t: title,
        apikey: apiKey,
      },
      timeout: 8000,
    });

    if (res.data && res.data.imdbID && res.data.imdbID.startsWith("tt")) {
      return res.data.imdbID;
    }
  } catch (e) {
    console.error("OMDb error:", e.message);
  }

  return null;
}

async function loginTB7() {
  const config = (await kv.hgetall("tb7:config")) || {};
  const login = config.login;
  const password = config.password;

  if (!login || !password) {
    throw new Error("Brak loginu/hasła TB7 w konfiguracji");
  }

  const cachedCookie = await kv.get("tb7:sessionCookie");
  if (cachedCookie) {
    return cachedCookie;
  }

  const res = await axios.post(
    `${TB7_BASE_URL}/zaloguj`,
    new URLSearchParams({
      login,
      haslo: password,
    }),
    {
      maxRedirects: 0,
      validateStatus: (s) => s === 302 || s === 200 || s === 301,
    }
  );

  const setCookie = res.headers["set-cookie"];
  if (!setCookie || !setCookie.length) {
    throw new Error("TB7 nie zwrócił cookie po logowaniu");
  }

  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");

  await kv.set("tb7:sessionCookie", cookie, { ex: 6 * 60 * 60 });

  return cookie;
}

// Pobiera katalog z TB7 z paginacją
async function fetchTb7Catalog(type, page, limit, cookie) {
  const url =
    type === "series"
      ? `${TB7_BASE_URL}/seriale`
      : `${TB7_BASE_URL}/filmy`;

  const res = await axios.get(url, {
    params: { page },
    headers: { Cookie: cookie },
  });

  const $ = cheerio.load(res.data);
  const metas = [];

  $(".film, .episode, .item").each((i, el) => {
    if (metas.length >= limit) return;

    const name =
      $(el).find(".title").text().trim() ||
      $(el).find("h2").text().trim() ||
      null;

    if (!name) return;

    const yearText = $(el).find(".year").text().trim();
    const poster = $(el).find("img").attr("src");

    metas.push({
      name,
      year: yearText || undefined,
      poster:
        poster && poster.startsWith("http")
          ? poster
          : poster
          ? `${TB7_BASE_URL}${poster}`
          : undefined,
      type,
    });
  });

  return metas;
}

export default async function handler(req, res) {
  try {
    const { type = "movie", page = "1", limit = "20" } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

    const cookie = await loginTB7();
    const rawMetas = await fetchTb7Catalog(type, pageNum, limitNum, cookie);

    const metas = [];

    // Dodaj IMDb ID do każdego wpisu
    for (const item of rawMetas) {
      const imdbId = await getImdbFromTitle(item.name);

      metas.push({
        id: imdbId || item.name, // IMDb jeśli jest, fallback: nazwa
        type: item.type,
        name: item.name,
        year: item.year,
        poster: item.poster,
      });
    }

    return res.status(200).json({ metas });
  } catch (err) {
    console.error("CATALOG ERROR:", err);
    return res.status(500).json({ metas: [], error: err.message || "Internal error" });
  }
}
