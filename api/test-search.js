import axios from "axios";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";

const TB7_BASE_URL = "https://tb7.pl";

// Logowanie do TB7
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

// Testowe wyszukiwanie TB7
async function searchTB7(query, cookie) {
  const res = await axios.get(`${TB7_BASE_URL}/szukaj`, {
    params: { q: query },
    headers: { Cookie: cookie },
  });

  const $ = cheerio.load(res.data);
  const results = [];

  $(".film, .episode, .item").each((i, el) => {
    const name =
      $(el).find(".title").text().trim() ||
      $(el).find("h2").text().trim();

    const href = $(el).find("a").attr("href");

    if (!name || !href) return;

    results.push({
      name,
      url: href.startsWith("http") ? href : `${TB7_BASE_URL}${href}`,
    });
  });

  return results;
}

export default async function handler(req, res) {
  try {
    const q = req.query.q || "Kler";

    const cookie = await loginTB7();
    const results = await searchTB7(q, cookie);

    return res.status(200).json({
      query: q,
      count: results.length,
      results,
    });
  } catch (err) {
    console.error("TEST SEARCH ERROR:", err);
    return res.status(500).json({
      error: err.message || "Internal error",
    });
  }
}
