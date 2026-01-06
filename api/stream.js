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
    }
  );

  const set = r.headers["set-cookie"];
  if (!set) throw new Error("Brak cookie TB7");

  const cookie = set.map((c) => c.split(";")[0]).join("; ");
  await kv.set("tb7:cookie", cookie, { ex: 6 * 60 * 60 });

  return cookie;
}

// Szukanie filmu
async function search(title, year, cookie) {
  const r = await axios.post(
    `${TB7}/mojekonto/szukaj`,
    new URLSearchParams({ search: title, type: "1" }),
    {
      headers: { Cookie: cookie },
    }
  );

  const $ = cheerio.load(r.data);
  const results = [];

  $(".btn-1").each((i, el) => {
    const form = $(el).closest("form");
    const content = form.find("input[name='content']").attr("value");
    const name = content?.split("/").pop();

    if (!content || !name) return;

    results.push({ content, name });
  });

  return results;
}

// Pobranie linków z /mojekonto/sciagaj
async function getLinks(content, cookie) {
  const r = await axios.post(
    `${TB7}/mojekonto/sciagaj`,
    new URLSearchParams({ content }),
    {
      headers: { Cookie: cookie },
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
    let year = null;

    if (id.startsWith("tt")) {
      const t = await getTitle(id);
      if (t) {
        title = t.title;
        year = t.year;
      }
    }

    const cookie = await login();
    const results = await search(title, year, cookie);

    if (!results.length) return res.status(200).json({ streams: [] });

    const links = await getLinks(results[0].content, cookie);

    return res.status(200).json({
      streams: links.map((url) => ({
        name: "TB7 Premium",
        title: results[0].name,
        url,
      })),
    });
  } catch (e) {
    return res.status(500).json({ streams: [], error: e.message });
  }
}
