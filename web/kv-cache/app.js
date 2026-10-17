export const MODELS = {
  "llama2-7b": {
    label: "Llama-2-7B · MHA",
    layers: 32,
    kvHeads: 32,
    headDim: 128,
    perTokenBytes: 524288,
    note: "MHA：每层 32 个 KV head，每个 head 128 维",
  },
  "llama2-13b": {
    label: "Llama-2-13B · MHA",
    layers: 40,
    kvHeads: 40,
    headDim: 128,
    perTokenBytes: 819200,
    note: "MHA：层数与 kv head 数一起涨，单价跟着涨",
  },
  "llama3-8b": {
    label: "Llama-3-8B · GQA",
    layers: 32,
    kvHeads: 8,
    headDim: 128,
    perTokenBytes: 131072,
    note: "GQA：多个 query head 共用 8 个 KV head",
  },
  "mistral-7b": {
    label: "Mistral-7B · GQA",
    layers: 32,
    kvHeads: 8,
    headDim: 128,
    perTokenBytes: 131072,
    note: "GQA：形状与 Llama-3-8B 相同",
  },
  "llama3-70b": {
    label: "Llama-3-70B · GQA",
    layers: 80,
    kvHeads: 8,
    headDim: 128,
    perTokenBytes: 327680,
    note: "GQA：层数多，每 token 的单价跟着涨",
  },
  "deepseek-v2": {
    label: "DeepSeek-V2 · MLA",
    layers: 60,
    kvHeads: null,
    headDim: null,
    perTokenBytes: 69120,
    note: "MLA：每层每 token 一个 576 维 latent",
  },
};

const KIB = 1024;
const MIB = KIB * KIB;
const GIB = MIB * KIB;
const KNOWN_WEIGHTS = Object.freeze({ "llama2-7b": 14e9 });
const BANDWIDTHS = [2039, 3350];
const BAR_CELLS = 24;
const RENDER_INTERVAL = 150;
const TOKEN_MIN = 128;
const TOKEN_MAX = 32768;
const TOKEN_STEP = 128;
const PAGE_FACTOR = 10;

export function cacheBytes(key, tokens) {
  const model = MODELS[key];
  if (!model) return 0;
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return model.perTokenBytes * Math.floor(tokens);
}

export function weightsBytes(key) {
  return Object.hasOwn(KNOWN_WEIGHTS, key) ? KNOWN_WEIGHTS[key] : null;
}

export function stepReadBytes(key, tokens) {
  const weights = weightsBytes(key);
  if (weights === null) return null;
  return cacheBytes(key, tokens) + weights;
}

export function tokPerSec(key, tokens, bandwidthGBs) {
  const bytes = stepReadBytes(key, tokens);
  if (bytes === null || !(bytes > 0)) return null;
  if (!(bandwidthGBs > 0)) return null;
  return Math.floor((bandwidthGBs * 1e9) / bytes);
}

function trim(value) {
  const fixed = value.toFixed(2).replace(/0+$/, "");
  return fixed.endsWith(".") ? fixed.slice(0, -1) : fixed;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return { value: "0", unit: "B" };
  if (bytes >= GIB) return { value: (bytes / GIB).toFixed(2), unit: "GiB" };
  if (bytes >= MIB) return { value: trim(bytes / MIB), unit: "MiB" };
  if (bytes >= KIB) return { value: trim(bytes / KIB), unit: "KiB" };
  return { value: String(Math.round(bytes)), unit: "B" };
}

const join = (bytes) => {
  const text = formatBytes(bytes);
  return `${text.value} ${text.unit}`;
};

const count = (value) => value.toLocaleString("en-US");

function mount(doc) {
  const rail = doc.getElementById("rail");
  const tokenInput = doc.getElementById("tokens");
  const readout = doc.getElementById("readout");
  if (!rail || !tokenInput || !readout) return;

  const bar = readout.querySelector("[data-bar]");
  const modelInputs = Array.from(doc.querySelectorAll('input[name="model"]'));
  const budgetInputs = Array.from(doc.querySelectorAll('input[name="budget"]'));
  if (!bar || modelInputs.length === 0 || budgetInputs.length === 0) return;

  const picked = (inputs) => inputs.find((input) => input.checked) || inputs[0];

  const state = {
    model: picked(modelInputs).value,
    tokens: Number(tokenInput.value),
    budget: Number(picked(budgetInputs).value),
  };

  const out = {
    perToken: readout.querySelector('[data-out="perToken"]'),
    cache: readout.querySelector('[data-out="cache"]'),
    note: readout.querySelector('[data-out="note"]'),
    usage: readout.querySelector('[data-out="usage"]'),
    step: readout.querySelector('[data-out="step"]'),
    sentence: readout.querySelector('[data-out="sentence"]'),
  };

  const live = {
    layers: rail.querySelector('[data-live="layers"]'),
    kvHeads: rail.querySelector('[data-live="kvHeads"]'),
    headDim: rail.querySelector('[data-live="headDim"]'),
    tokens: rail.querySelector('[data-live="tokens"]'),
    product: rail.querySelector('[data-live="product"]'),
    compactTokens: rail.querySelector('[data-live="compact-tokens"]'),
    compactCache: rail.querySelector('[data-live="compact-cache"]'),
  };

  const factors = Array.from(rail.querySelectorAll(".factor"));
  const cells = [];
  for (let index = 0; index < BAR_CELLS; index += 1) {
    const cell = doc.createElement("span");
    cell.className = "bar-cell";
    cells.push(cell);
    bar.append(cell);
  }

  doc.querySelectorAll("[data-model]").forEach((node) => {
    const model = MODELS[node.dataset.model];
    if (model) node.textContent = model.label;
  });

  function render() {
    const model = MODELS[state.model];
    const cache = cacheBytes(state.model, state.tokens);
    const weights = weightsBytes(state.model);
    const read = stepReadBytes(state.model, state.tokens);
    const cacheText = join(cache);
    const tokensText = count(state.tokens);
    const budgetBytes = state.budget * GIB;
    const perCell = budgetBytes / BAR_CELLS;

    out.perToken.textContent = join(model.perTokenBytes);
    out.cache.textContent = cacheText;
    out.note.textContent = model.note;

    const used = weights === null ? cache : cache + weights;
    const over = used > budgetBytes;
    const cacheCells = Math.min(BAR_CELLS, Math.round(cache / perCell));
    const weightCells = weights === null ? 0 : Math.max(0, Math.round(weights / perCell));
    cells.forEach((cell, index) => {
      if (index < cacheCells) cell.className = "bar-cell is-cache";
      else if (index < cacheCells + weightCells) cell.className = "bar-cell is-weight";
      else cell.className = "bar-cell";
    });
    bar.dataset.over = over ? "true" : "false";

    if (weights === null) {
      out.usage.textContent = `缓存 ${cacheText}，预算 ${state.budget} GiB。`;
    } else if (over) {
      out.usage.textContent = `缓存 ${cacheText} + 权重 ${join(weights)}，超出预算 ${join(used - budgetBytes)}。`;
    } else {
      out.usage.textContent = `缓存 ${cacheText} + 权重 ${join(weights)}，预算 ${state.budget} GiB。`;
    }

    if (read === null) {
      out.step.textContent = "本页未给出该模型的权重。";
    } else {
      const low = tokPerSec(state.model, state.tokens, BANDWIDTHS[0]);
      const high = tokPerSec(state.model, state.tokens, BANDWIDTHS[1]);
      out.step.textContent = `单步读取 ${join(read)} · 带宽上限 ${low} / ${high} tok/s。`;
    }

    out.sentence.textContent =
      weights === null
        ? `本页未给出该模型的权重，缓存是你拖出来的 ${cacheText}。`
        : `权重固定 ${join(weights)}，缓存是你拖出来的 ${cacheText}。`;

    tokenInput.setAttribute("aria-valuetext", `${tokensText} tokens，缓存 ${cacheText}`);

    live.layers.textContent = String(model.layers);
    live.tokens.textContent = tokensText;
    live.product.textContent = cacheText;
    live.compactTokens.textContent = tokensText;
    live.compactCache.textContent = cacheText;
    if (model.kvHeads === null) {
      rail.dataset.mla = "true";
      live.kvHeads.textContent = "";
      live.headDim.textContent = "";
    } else {
      rail.dataset.mla = "false";
      live.kvHeads.textContent = String(model.kvHeads);
      live.headDim.textContent = String(model.headDim);
    }
  }

  let timer = 0;
  let lastRun = 0;
  function schedule() {
    if (timer) return;
    const wait = Math.max(0, RENDER_INTERVAL - (performance.now() - lastRun));
    timer = setTimeout(() => {
      timer = 0;
      lastRun = performance.now();
      render();
    }, wait);
  }

  function setTokens(value) {
    const snapped = Math.round(value / TOKEN_STEP) * TOKEN_STEP;
    state.tokens = Math.min(TOKEN_MAX, Math.max(TOKEN_MIN, snapped));
    tokenInput.value = String(state.tokens);
    schedule();
  }

  tokenInput.addEventListener("input", () => {
    state.tokens = Number(tokenInput.value);
    schedule();
  });

  tokenInput.addEventListener("keydown", (event) => {
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      setTokens(event.key === "PageUp" ? state.tokens * PAGE_FACTOR : state.tokens / PAGE_FACTOR);
    } else if (event.key === "Home") {
      event.preventDefault();
      setTokens(TOKEN_MIN);
    } else if (event.key === "End") {
      event.preventDefault();
      setTokens(TOKEN_MAX);
    }
  });

  modelInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      state.model = input.value;
      render();
    });
  });

  budgetInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      state.budget = Number(input.value);
      render();
    });
  });

  const hero = doc.querySelector(".hero");
  const sections = Array.from(doc.querySelectorAll("section[data-factor]"));
  let ticking = false;

  function updateScrollState() {
    ticking = false;
    if (hero) rail.classList.toggle("is-pinned", hero.getBoundingClientRect().bottom <= 0);
    const line = window.innerHeight * 0.45;
    let current = null;
    sections.forEach((section) => {
      if (section.getBoundingClientRect().top <= line) current = section;
    });
    const key = current ? current.dataset.factor : "";
    factors.forEach((factor) => {
      const active = Boolean(current) && (key === "all" || factor.dataset.factor === key);
      factor.classList.toggle("is-active", active);
    });
    rail.classList.toggle("is-floor", Boolean(current) && current.id === "floor");
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateScrollState);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  render();
  updateScrollState();
}

if (typeof document !== "undefined") {
  mount(document);
}
