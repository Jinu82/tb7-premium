import axios from "axios";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";

const TB7_BASE_URL = "https://tb7.pl";

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

// Pobiera katalog z TB7 z prostą paginacją
async function fetchTb7Catalog(type, page, limit, cookie) {
  // Tu musisz dostosować URL do tego, jak TB7 paginuje listy:
  // np. /filmy?page=1, /seriale?page=1, itd.
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

    const name = $(el).find(".title").text().trim() || $(el).find("h2").text().trim();
    const yearText = $(el).find(".year").text().trim();
    const poster = $(el).find("img").attr("src");
    const imdbId =
      $(el).attr("data-imdb") ||
      $(el).find("[data-imdb]").attr("data-imdb") ||
      null;

    if (!name) return;

    metas.push({
      id: imdbId || name, // jeśli nie ma IMDb, użyj nazwy jako id
      type,
      name,
      year: yearText || undefined,
      poster: poster && poster.startsWith("http") ? poster : poster ? `${TB7_BASE_URL}${poster}` : undefined,
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
    const metas = await fetchTb7Catalog(type, pageNum, limitNum, cookie);

    return res.status(200).json({ metas });
  } catch (err) {
    console.error("CATALOG ERROR:", err);
    return res.status(500).json({ metas: [], error: err.message || "Internal error" });
  }
}
