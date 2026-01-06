import axios from "axios";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";

const TB7_BASE_URL = "https://tb7.pl";
const TMDB_KEY = process.env.TMDB_API_KEY;

// Usuwa polskie znaki
function stripPolish(text) {
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

// Pobiera tytuł PL z TMDb
async function getTMDbTitle(imdbId) {
  try {
    const res = await axios.get(
      `https://api.themoviedb.org/3/find/${imdbId}`,
      {
        params: {
          api_key: TMDB_KEY,
          language: "pl-PL",
          external_source: "imdb_id",
        },
      }
    );

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

// Logowanie do TB7
async function loginTB7() {
  const config = (await kv.hgetall("tb7:config")) || {};
  const login = config.login;
  const password = config.password;

  if (!login || !password) throw new Error("Brak loginu/hasła TB7");

  const cached = await kv.get("tb7:cookie");
  if (cached) return cached;

  const res = await axios.post(
    `${TB7_BASE_URL}/zaloguj`,
    new URLSearchParams({ login, haslo: password }),
    {
      maxRedirects: 0,
      validateStatus: (s) => s === 302 || s === 200,
    }
  );

  const setCookie = res.headers["set-cookie"];
  if (!setCookie) throw new Error("TB7 nie zwrócił cookie");

  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  await kv.set("tb7:cookie", cookie, { ex: 6 * 60 * 60 });

  return cookie;
}

// Szukanie na TB7
async function searchTB7(title, year, cookie) {
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

    results.push({ content, name });
  });

  return results;
}

// Pobranie linków z /mojekonto/sciagaj
async function getDownloadLinks(content, cookie) {
  const res = await axios.post(
    `${TB7_BASE_URL}/mojekonto/sciagaj`,
    new URLSearchParams({ content }),
    {
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const $ = cheerio.load(res.data);
  const textarea = $("textarea").text().trim();

  if (!textarea) return [];

  return textarea
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5);
}

export default async function handler(req, res) {
  try {
    const { id } = req.query;
    if (!id) return res.status(200).json({ streams: [] });

    let title = id;
    let year = null;

    // Pobierz tytuł z TMDb
    if (id.startsWith("tt")) {
      const tmdb = await getTMDbTitle(id);
      if (tmdb) {
        title = tmdb.title;
        year = tmdb.year;
      }
    }

    const cookie = await loginTB7();

    // Fallbacki wyszukiwania
    const attempts = [
      title,
      stripPolish(title),
      id,
    ];

    let found = null;

    for (const t of attempts) {
      const results = await searchTB7(t, year, cookie);
      if (results.length) {
        found = results[0];
        break;
      }
    }

    if (!found) {
      return res.status(200).json({ streams: [] });
    }

    // Kliknięcie = zgoda → pobieramy linki
    const links = await getDownloadLinks(found.content, cookie);

    return res.status(200).json({
      streams: links.map((url) => ({
        name: "TB7 Premium",
        title: found.name,
        url,
      })),
    });
  } catch (err) {
    return res.status(500).json({ streams: [], error: err.message });
  }
}
