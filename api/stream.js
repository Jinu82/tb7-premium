import axios from "axios";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";

const TB7_BASE_URL = "https://tb7.pl";

// Pobranie tytułu i roku z IMDb przez OMDb
async function getTitleAndYearFromImdb(imdbId) {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) return { title: imdbId, year: null };

  const res = await axios.get("https://www.omdbapi.com/", {
    params: { i: imdbId, apikey: apiKey },
    timeout: 8000,
  });

  if (!res.data || res.data.Response === "False") {
    return { title: imdbId, year: null };
  }

  return {
    title: res.data.Title || imdbId,
    year: res.data.Year || null,
  };
}

// Logowanie do TB7
async function loginTB7() {
  const config = (await kv.hgetall("tb7:config")) || {};
  const login = config.login;
  const password = config.password;

  if (!login || !password) {
    throw new Error("Brak loginu/hasła TB7 w konfiguracji");
  }

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
  if (!setCookie || !setCookie.length) {
    throw new Error("TB7 nie zwrócił cookie po logowaniu");
  }

  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  await kv.set("tb7:sessionCookie", cookie, { ex: 6 * 60 * 60 });
  return cookie;
}

// Wyszukiwanie na TB7 przez POST
async function searchTB7ByTitle(title, year, cookie) {
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

    // Filtrowanie: musi zawierać tytuł i rok
    if (!nameLower.includes(titleLower)) return;
    if (year && !nameLower.includes(year)) return;

    results.push({
      name,
      url: `${TB7_BASE_URL}/mojekonto/szukaj`,
    });
  });

  return results;
}

// Generowanie streamów
async function getStreamsFromTB7(title, year, type) {
  const cookie = await loginTB7();
  const results = await searchTB7ByTitle(title, year, cookie);

  if (!results.length) return [];

  return results.map((r) => ({
    name: "TB7 Premium",
    title: r.name,
    url: r.url,
  }));
}

export default async function handler(req, res) {
  try {
    const { type = "movie", id } = req.query;
    if (!id) return res.status(400).json({ streams: [], error: "Missing id" });

    let title = id;
    let year = null;

    if (id.startsWith("tt")) {
      const data = await getTitleAndYearFromImdb(id);
      title = data.title;
      year = data.year;
    }

    const streams = await getStreamsFromTB7(title, year, type);
    return res.status(200).json({ streams });
  } catch (err) {
    console.error("STREAM ERROR:", err);
    return res.status(500).json({ streams: [], error: err.message || "Internal error" });
  }
}
