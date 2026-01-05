import { kv } from "@vercel/kv";

// prosta parska x-www-form-urlencoded z POST
async function parseBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", chunk => {
            data += chunk.toString();
        });
        req.on("end", () => {
            const params = new URLSearchParams(data);
            const result = {};
            for (const [key, value] of params.entries()) {
                result[key] = value;
            }
            resolve(result);
        });
        req.on("error", reject);
    });
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");

    // UŻYWAMY STAŁEGO KLUCZA
    const KEY = "tb7:config";

    if (req.method === "POST") {
        const body = await parseBody(req);
        const login = body.login || "";
        const password = body.password || "";
        const mode = body.mode === "ip" ? "ip" : "cookie";

        // ZAPIS DO JEDNEGO MIEJSCA
        await kv.hset(KEY, {
            login,
            password,
            mode
        });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end("<h3>Zapisano! Możesz wrócić do Stremio.</h3>");
        return;
    }

    // ODCZYT Z JEDNEGO MIEJSCA
    const data = (await kv.hgetall(KEY)) || {};
    const login = data.login || "";
    const password = data.password || "";
    const mode = data.mode === "ip" ? "ip" : "cookie";

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`
        <html>
          <head>
            <meta charset="utf-8" />
            <title>TB7 Premium - Konfiguracja</title>
          </head>
          <body style="font-family: sans-serif; max-width: 480px; margin: 20px auto;">
            <h2>Konfiguracja TB7 Premium</h2>
            <form method="POST">
              <label>Login TB7:</label><br>
              <input name="login" value="${escapeHtml(login)}" style="width: 100%;" /><br><br>

              <label>Hasło TB7:</label><br>
              <input name="password" type="password" value="${escapeHtml(password)}" style="width: 100%;" /><br><br>

              <label>Tryb identyfikacji:</label><br>
              <select name="mode" style="width: 100%;">
                <option value="cookie" ${mode === "cookie" ? "selected" : ""}>Cookie (zalecane)</option>
                <option value="ip" ${mode === "ip" ? "selected" : ""}>IP (awaryjne)</option>
              </select><br><br>

              <button type="submit" style="padding: 8px 16px;">Zapisz</button>
            </form>
          </body>
        </html>
    `);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
