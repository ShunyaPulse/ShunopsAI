import https from "node:https";

const queries = [
  "Shadab Khan Pakistan celebration thrilling finish England",
  "Pakistan vs England cricket match 2024 2026 thriller celebration",
  "Shadab Khan roaring celebration bat helmet cricket"
];

async function fetchGoogleImages(query: string): Promise<string[]> {
  return new Promise((resolve) => {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const urls = data.match(/https:\/\/encrypted-tbn0\.gstatic\.com\/images\?q=tbn:[^"'\\]+/g) || [];
          resolve([...new Set(urls)].slice(0, 4));
        });
      }
    );
    req.on("error", () => resolve([]));
  });
}

async function main() {
  for (const q of queries) {
    const results = await fetchGoogleImages(q);
    console.log(`QUERY: "${q}"`);
    for (const r of results) {
      console.log(`- ${r}`);
    }
  }
}

main();

