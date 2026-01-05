import axios from "axios";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";

const TB7_BASE_URL = "https://tb7.pl";

// Pobranie tytułu z IMDb przez OMDb
async function getTitleFromImdb(imdbId) {
  const apiKey = process.env.OMDB_API_KEY;

  // Jeśli nie ma klucza – używamy imdbId jako „awaryjnej nazwy” (żeby nie wywalać funkcji)
  if (!apiKey) {
    return imdbId;
  }

  const res = await axios.get("https://www.omdbapi.com/", {
    params: {
      i: imdbId,
      apikey: apiKey,
    },
    timeout: 8000,
  });

  if (!res.data || res.data.Response === "False") {
    return imdbId;
  }

  return res.data.Title;
}

// Logowanie do TB7 – używa danych z /config (KV)
async function loginTB7() {
  const config = (await kv.hgetall("tb7:config")) || {};
  const login = config.login;
  const password = config.password;

  if (!login || !password) {
    throw new Error("Brak loginu/hasła TB7 w konfiguracji");
  }

  // Spróbuj użyć istniejącego cookie z KV (żeby nie logować za każdym razem)
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

  // Zapisz sesję na jakiś czas (np. 6h)
  await kv.set("tb7:sessionCookie", cookie, { ex: 6 * 60 * 60 });

  return cookie;
}

// Wyszukiwanie na TB7 po tytule (film lub serial)
async function searchTB7ByTitle(title, type, cookie) {
  // type: "movie" | "series"
  // Zakładam, że TB7 ma wspólną wyszukiwarkę po nazwie
  const res = await axios.get(`${TB7_BASE_URL}/szukaj`, {
    params: { q: title },
    headers: {
      Cookie: cookie,
    },
  });

  const $ = cheerio.load(res.data);
  const results = [];

  // Tu trzeba dopasować do HTML TB7 – zostawiam przykładową strukturę, którą możesz poprawić pod swój markup
  $(".film, .episode, .item").each((i, el) => {
    const name = $(el).find(".title").text().trim() || $(el).find("h2").text().trim();
    const href = $(el).find("a").attr("href");

    if (!name || !href) return;

    // Filtrujemy po typie, jeśli TB7 rozróżnia film/serial klasą lub innym markerem
    if (type === "movie" && $(el).hasClass("series")) return;
    if (type === "series" && $(el).hasClass("movie")) return;

    results.push({
      name,
      url: href.startsWith("http") ? href : `${TB7_BASE_URL}${href}`,
    });
  });

  return results;
}

// Generowanie listy streamów
async function getStreamsFromTB7(title, type, season, episode) {
  const cookie = await loginTB7();
  const results = await searchTB7ByTitle(title, type, cookie);

  if (!results.length) {
    return [];
  }

  // Na start: bierzemy pierwszy wynik z TB7
  const chosen = results[0];

  // Jeśli kiedyś będziesz miał bezpośrednie linki do plików / playerów, tu je wyciągniesz.
  // Na razie zwrócimy po prostu link do strony TB7.
  const streams = [
    {
      name: "TB7 Premium",
      title: chosen.name,
      url: chosen.url,
    },
  ];

  return streams;
}

export default async function handler(req, res) {
  try {
    const { type = "movie", id, season, episode } = req.query;

    if (!id) {
      return res.status(400).json({ streams: [], error: "Missing id" });
    }

    let titleForSearch;

    // Jeśli id wygląda jak IMDb (tt1234567) → pobierz tytuł z OMDb
    if (id.startsWith("tt")) {
      titleForSearch = await getTitleFromImdb(id);
    } else {
      // Jeśli kiedyś będziesz podawał nazwę bezpośrednio – użyj jej
      titleForSearch = id;
    }

    const streams = await getStreamsFromTB7(
      titleForSearch,
      type,
      season ? parseInt(season, 10) : undefined,
      episode ? parseInt(episode, 10) : undefined
    );

    return res.status(200).json({ streams });
  } catch (err) {
    console.error("STREAM ERROR:", err);
    return res.status(500).json({ streams: [], error: err.message || "Internal error" });
  }
}
