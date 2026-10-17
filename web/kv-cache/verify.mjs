import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8");
const fails = [];
const check = (ok, label, detail = "") => {
  if (!ok) fails.push(detail ? `${label} :: ${detail}` : label);
};

for (const name of ["index.html", "style.css", "app.js", "README.md"]) {
  check(existsSync(join(here, name)), `missing ${name}`);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}

const html = read("index.html");
const css = read("style.css");
const mod = await import(pathToFileURL(join(here, "app.js")).href);
const app = mod.default ?? mod;

const GiB = 1024 ** 3;
const truth = {
  "llama2-7b": { layers: 32, kvHeads: 32, headDim: 128, perToken: 524288, at4k: 2 * GiB, at8k: 4 * GiB, at32k: 16 * GiB },
  "llama2-13b": { layers: 40, kvHeads: 40, headDim: 128, perToken: 819200, at4k: 819200 * 4096, at8k: 819200 * 8192, at32k: 819200 * 32768 },
  "llama3-8b": { layers: 32, kvHeads: 8, headDim: 128, perToken: 131072, at4k: 131072 * 4096, at8k: GiB, at32k: 4 * GiB },
  "mistral-7b": { layers: 32, kvHeads: 8, headDim: 128, perToken: 131072, at4k: 131072 * 4096, at8k: GiB, at32k: 4 * GiB },
  "llama3-70b": { layers: 80, kvHeads: 8, headDim: 128, perToken: 327680, at4k: 327680 * 4096, at8k: 327680 * 8192, at32k: 327680 * 32768 },
  "deepseek-v2": { layers: 60, kvHeads: null, headDim: null, perToken: 69120, at4k: 69120 * 4096, at8k: 69120 * 8192, at32k: 69120 * 32768 },
};

check(Object.keys(app.MODELS ?? {}).length === 6, "MODELS must hold six models", Object.keys(app.MODELS ?? {}).join(","));
for (const [key, t] of Object.entries(truth)) {
  const m = app.MODELS[key];
  check(Boolean(m), `MODELS.${key} missing`);
  if (!m) continue;
  check(m.layers === t.layers, `MODELS.${key}.layers`, `${m.layers} != ${t.layers}`);
  check(m.kvHeads === t.kvHeads, `MODELS.${key}.kvHeads`, `${m.kvHeads} != ${t.kvHeads}`);
  check(m.headDim === t.headDim, `MODELS.${key}.headDim`, `${m.headDim} != ${t.headDim}`);
  check(m.perTokenBytes === t.perToken, `MODELS.${key}.perTokenBytes`, `${m.perTokenBytes} != ${t.perToken}`);
  for (const [ctx, want] of [["at4k", t.at4k], ["at8k", t.at8k], ["at32k", t.at32k]]) {
    const tokens = Number(ctx.slice(2).replace(/k$/, "")) * 1024;
    const got = app.cacheBytes(key, tokens);
    check(got === want, `cacheBytes(${key}, ${ctx.slice(2)})`, `${got} != ${want}`);
  }
}

check(app.weightsBytes("llama2-7b") === 14e9, "weightsBytes(llama2-7b) must be 14e9", String(app.weightsBytes("llama2-7b")));
for (const key of ["llama2-13b", "llama3-8b", "mistral-7b", "llama3-70b", "deepseek-v2"]) {
  check(app.weightsBytes(key) === null, `weightsBytes(${key}) must be null`, String(app.weightsBytes(key)));
}
check(app.stepReadBytes("llama2-7b", 4096) === 14e9 + 2 * GiB, "stepReadBytes(llama2-7b, 4096)", String(app.stepReadBytes("llama2-7b", 4096)));
check(app.stepReadBytes("llama3-8b", 4096) === null, "stepReadBytes must be null when weights are unknown", String(app.stepReadBytes("llama3-8b", 4096)));
const bounds = { 4096: [126, 207], 32768: [65, 107] };
for (const [ctx, [a, b]] of Object.entries(bounds)) {
  check(app.tokPerSec("llama2-7b", Number(ctx), 2039) === a, `tokPerSec at ${ctx} on 2039 GB/s`, String(app.tokPerSec("llama2-7b", Number(ctx), 2039)));
  check(app.tokPerSec("llama2-7b", Number(ctx), 3350) === b, `tokPerSec at ${ctx} on 3350 GB/s`, String(app.tokPerSec("llama2-7b", Number(ctx), 3350)));
  check(app.tokPerSec("llama3-8b", Number(ctx), 2039) === null, "tokPerSec must be null when weights are unknown");
}
const f = app.formatBytes(2 * GiB);
check(f && f.value === "2.00" && f.unit === "GiB", "formatBytes(2 GiB)", JSON.stringify(f));
const fm = app.formatBytes(131072 * 4096);
check(fm && fm.value === "512" && fm.unit === "MiB", "formatBytes(512 MiB)", JSON.stringify(fm));

check(/<html[^>]+lang="zh/i.test(html), "html lang must be zh");
check((html.match(/<h1[\s>]/g) ?? []).length === 1, "exactly one h1", String((html.match(/<h1[\s>]/g) ?? []).length));
check((html.match(/<h2[\s>]/g) ?? []).length === 12, "exactly twelve h2", String((html.match(/<h2[\s>]/g) ?? []).length));
check(/prefers-reduced-motion/.test(css), "css must honour prefers-reduced-motion");
check(/:focus-visible/.test(css), "css must define :focus-visible");
check(!/overflow-x\s*:\s*(auto|scroll)/.test(css), "no horizontal scroll container");
check(!/@import/.test(css), "no @import in css");
check(!/<script[^>]+src="(https?:)?\/\//i.test(html), "no remote script");
check(!/<link[^>]+href="(https?:)?\/\//i.test(html), "no external stylesheet or font");
check(!/TODO|FIXME|lorem ipsum|placeholder/i.test(html + css + read("app.js")), "no placeholder text");
check(!/NaN|undefined/.test(html), "no NaN or undefined in markup");

for (const [svg, i] of [...html.matchAll(/<svg[\s\S]*?<\/svg>/g)].map((m, i) => [m[0], i])) {
  check(/<title[^>]*>\s*\S/.test(svg), `svg ${i + 1} needs a title`);
  check(/<desc[^>]*>\s*\S/.test(svg), `svg ${i + 1} needs a desc`);
  check(/role="img"/.test(svg), `svg ${i + 1} needs role="img"`);
}

const arxiv = new Set([
  "https://arxiv.org/abs/2309.06180", "https://arxiv.org/abs/2205.14135",
  "https://arxiv.org/abs/2305.13245", "https://arxiv.org/abs/1911.02150",
  "https://arxiv.org/abs/2309.17453", "https://arxiv.org/abs/2306.14048",
  "https://arxiv.org/abs/2405.04434", "https://arxiv.org/abs/2310.06825",
  "https://arxiv.org/abs/2402.02750",
]);
for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
  if (href.startsWith("#")) {
    check(html.includes(`id="${href.slice(1)}"`), `anchor ${href} has no target`);
  } else if (existsSync(join(here, href.split("?")[0]))) {
    check(true, `local asset ${href}`);
  } else {
    check(arxiv.has(href), `unexpected link ${href}`);
  }
}

check((html.match(/<script[\s>]/g) ?? []).length === 1, "exactly one script tag", String((html.match(/<script[\s>]/g) ?? []).length));
check(/<script[^>]+src="app\.js"/.test(html), "app.js must be the loaded script, not an inline copy");
check(!/<script[^>]+type="module"/.test(html), "a module script cannot load from file://");
const f2 = html.match(/<svg class="fig fig-step"[\s\S]*?<\/svg>/)?.[0] ?? "";
check(Boolean(f2), "F2 diagram missing");
check((f2.match(/class="a-link"/g) ?? []).length >= 12, "F2 needs twelve connectors from q_t to the cached rows", String((f2.match(/class="a-link"/g) ?? []).length));
check((f2.match(/class="a-neutral"/g) ?? []).length === 0, "F2 draws q_t and o_t as empty boxes");
check((f2.match(/class="a-score"/g) ?? []).length === 12, "F2 needs twelve score cells", String((f2.match(/class="a-score"/g) ?? []).length));
const deepseek32k = app.formatBytes(app.cacheBytes("deepseek-v2", 32768));
check(deepseek32k.value === "2.11", "deepseek-v2 32k is 2.11 GiB", JSON.stringify(deepseek32k));
check(html.includes(`${deepseek32k.value} ${deepseek32k.unit}`), "the 32k cell must match the computed value", `${deepseek32k.value} ${deepseek32k.unit}`);
const f4 = html.match(/<svg class="fig fig-token"[\s\S]*?<\/svg>/)?.[0] ?? "";
for (const m of Object.values(app.MODELS)) {
  check(f4.includes(m.label.split(" \u00b7 ")[0]), "F4 must label each model by name", m.label);
}

const text = html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-z]+;/gi, " ");
const allowed = new Set([
  "0.5", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
  "17", "18", "19", "20", "24", "25", "28", "32", "36", "40", "45", "48", "60", "64", "80", "107",
  "126", "128", "207", "320", "65", "270", "512", "540", "576", "800", "8192", "819200", "131072", "524288",
  "327680", "69120", "2.00", "3.13", "4.00", "6.25", "1.25", "2.50", "10.00", "16.00", "25.00",
  "1.00", "8.00", "13.04", "15.04", "29.04", "2.11", "2.125", "7.6", "2039", "3350", "32768",
  "1,152", "8,192", "32,768", "67.5", "1024", "1,024", "16,384",
]);
for (const m of Object.values(app.MODELS)) {
  for (const digits of m.label.match(/\d[\d,.]*/g) ?? []) allowed.add(digits);
}
for (const t of Object.values(truth)) {
  for (const bytes of [t.at4k, t.at8k, t.at32k]) {
    const f = app.formatBytes(bytes);
    if (f) allowed.add(f.value);
  }
}
const unknown = [...new Set((text.match(/\d[\d,.]*/g) ?? []).map((s) => s.replace(/[.,]$/, "")))]
  .filter((s) => !allowed.has(s));
check(unknown.length === 0, "numbers outside the allowlist", unknown.join(" "));

if (fails.length) {
  console.error(`FAIL ${fails.length}`);
  for (const line of fails) console.error(`- ${line}`);
  process.exit(1);
}
console.log(`ok: ${Object.keys(truth).length} models, ${(html.match(/<h2[\s>]/g) ?? []).length} sections, ${(html.match(/<svg/g) ?? []).length} diagrams, links and numbers within contract`);
