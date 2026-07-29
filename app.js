const RSS2JSON_ENDPOINT = "https://api.rss2json.com/v1/api.json?rss_url=";

const SOURCES = [
  { name: "Ada Derana", url: "https://www.adaderana.lk/rss.php" },
  { name: "The Island", url: "https://island.lk/feed/" },
  { name: "EconomyNext", url: "https://economynext.com/feed" },
  { name: "Newswire", url: "https://www.newswire.lk/feed/" },
];

const KEYWORD_CATEGORIES = {
  politics: ["president", "prime minister", "parliament", "cabinet", "minister", "election", "npp", "jvp", "mp ", "speaker of parliament", "opposition"],
  economy: ["imf", "budget", "rupee", "inflation", "central bank", "tax", "debt", "export", "import", "gdp", "treasury", "economy"],
  judiciary: ["court", "chief justice", "supreme court", "attorney general", "verdict", "judge", "law college", "bar association", "magistrate"],
  disasters: ["flood", "landslide", "cyclone", "ditwah", "earthquake", "tsunami", "disaster", "drought", "fire ", "kumamoto", "quake"],
  international: ["india", "china", "united states", "united nations", "un ", "diplomat", "embassy", "foreign ministry", "bilateral", "summit", "hormuz", "iran", "israel", "takaichi", "japan"],
  sports: ["cricket", "rugby", "olympic", "athletics", "world cup", "football", "match", "tournament", "fifa", "ipl", "mbappe", "messi", "rodri"],
};

const BOOKMARK_KEY = "gk-exam-helper-bookmarks";
const CACHE_KEY = "gk-exam-helper-news-cache";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const googleNewsSearchUrl = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-LK&gl=LK&ceid=LK:en`;

let allItems = [];
let state = {
  category: "all",
  query: "",
  bookmarkedOnly: false,
  webSearchActive: false,
  webSearchResults: [],
  webSearchQuery: "",
};

function getBookmarks() {
  try {
    return JSON.parse(localStorage.getItem(BOOKMARK_KEY)) || [];
  } catch {
    return [];
  }
}

function toggleBookmark(link) {
  const bookmarks = getBookmarks();
  const idx = bookmarks.indexOf(link);
  if (idx === -1) bookmarks.push(link);
  else bookmarks.splice(idx, 1);
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks));
}

function tagItem(item) {
  const text = `${item.title} ${item.description || ""}`.toLowerCase();
  for (const [category, keywords] of Object.entries(KEYWORD_CATEGORIES)) {
    if (keywords.some((kw) => text.includes(kw))) return category;
  }
  return "general";
}

async function fetchSource(source) {
  const res = await fetch(RSS2JSON_ENDPOINT + encodeURIComponent(source.url));
  const data = await res.json();
  if (data.status !== "ok") throw new Error(`${source.name}: ${data.message || "unknown error"}`);
  return data.items.map((item) => ({
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    source: source.name,
    category: tagItem(item),
  }));
}

function readCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.items;
  } catch {
    /* ignore malformed cache */
  }
  return null;
}

function writeCache(items) {
  sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), items }));
}

async function loadNews(force = false) {
  const statusEl = document.getElementById("status");

  if (!force) {
    const cached = readCache();
    if (cached) {
      allItems = cached;
      renderNews();
      statusEl.textContent = `Loaded ${cached.length} stories (cached).`;
      return;
    }
  }

  statusEl.textContent = "Fetching latest news…";
  const results = await Promise.allSettled(SOURCES.map(fetchSource));

  const items = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else failures.push(SOURCES[i].name);
  });

  items.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
  allItems = items;
  writeCache(items);
  renderNews();

  let msg = `Loaded ${items.length} stories from ${SOURCES.length - failures.length}/${SOURCES.length} sources.`;
  if (failures.length) msg += ` (Failed: ${failures.join(", ")})`;
  statusEl.textContent = msg;
}

async function searchWeb(query) {
  const trimmed = query.trim();
  if (!trimmed) return;

  const statusEl = document.getElementById("status");
  statusEl.textContent = `Searching the web for "${trimmed}"…`;

  try {
    const res = await fetch(RSS2JSON_ENDPOINT + encodeURIComponent(googleNewsSearchUrl(trimmed)));
    const data = await res.json();
    if (data.status !== "ok") throw new Error(data.message || "search failed");

    const items = data.items.map((item) => {
      // Google News titles end in " - <Publisher>"; split it out for a cleaner source label.
      const match = item.title.match(/^(.*)\s-\s([^-]+)$/);
      return {
        title: match ? match[1] : item.title,
        link: item.link,
        pubDate: item.pubDate,
        source: match ? match[2] : "Google News",
        category: tagItem(item),
      };
    });

    state.webSearchActive = true;
    state.webSearchQuery = trimmed;
    state.webSearchResults = items;
    document.getElementById("clear-search-btn").hidden = false;
    renderNews();
    statusEl.textContent = `Found ${items.length} web results for "${trimmed}" (via Google News).`;
  } catch (err) {
    statusEl.textContent = `Web search failed: ${err.message}`;
  }
}

function clearWebSearch() {
  state.webSearchActive = false;
  state.webSearchQuery = "";
  state.webSearchResults = [];
  state.query = "";
  document.getElementById("search-input").value = "";
  document.getElementById("clear-search-btn").hidden = true;
  renderNews();
  document.getElementById("status").textContent = `Loaded ${allItems.length} stories.`;
}

function formatDate(pubDate) {
  if (!pubDate) return "";
  const d = new Date(pubDate);
  if (isNaN(d)) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderNews() {
  const list = document.getElementById("news-list");
  const bookmarks = getBookmarks();
  const query = state.query.trim().toLowerCase();
  const baseItems = state.webSearchActive ? state.webSearchResults : allItems;

  const filtered = baseItems.filter((item) => {
    if (state.category !== "all" && item.category !== state.category) return false;
    if (state.bookmarkedOnly && !bookmarks.includes(item.link)) return false;
    // Trust Google's own relevance ranking for web-search results instead of re-filtering by title substring.
    if (!state.webSearchActive && query && !item.title.toLowerCase().includes(query)) return false;
    return true;
  });

  list.innerHTML = "";
  if (filtered.length === 0) {
    const msg = state.webSearchActive ? "No web results match your filters." : "No stories match your filters.";
    list.innerHTML = `<li class="empty-state">${msg}</li>`;
    return;
  }

  for (const item of filtered) {
    const isSaved = bookmarks.includes(item.link);
    const li = document.createElement("li");
    li.className = "news-item";
    li.innerHTML = `
      <div class="meta">
        <span>${item.source}${item.pubDate ? " · " + formatDate(item.pubDate) : ""}</span>
        <span class="tag">${item.category}</span>
      </div>
      <div class="row">
        <h3><a href="${item.link}" target="_blank" rel="noopener">${item.title}</a></h3>
        <button class="bookmark-btn ${isSaved ? "saved" : ""}" data-link="${item.link}" title="Bookmark">${isSaved ? "★" : "☆"}</button>
      </div>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll(".bookmark-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleBookmark(btn.dataset.link);
      renderNews();
    });
  });
}

async function loadFundamentals() {
  const container = document.getElementById("fundamentals-list");
  try {
    const res = await fetch("gk_study_data.json");
    const data = await res.json();
    renderFundamentals(data.categories, "");

    document.getElementById("fund-search-input").addEventListener("input", (e) => {
      renderFundamentals(data.categories, e.target.value.trim().toLowerCase());
    });
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Could not load gk_study_data.json (${err.message}).</p>`;
  }
}

function renderFundamentals(categories, query) {
  const container = document.getElementById("fundamentals-list");
  container.innerHTML = "";

  for (const [category, facts] of Object.entries(categories)) {
    const filtered = query
      ? facts.filter((f) => `${f.fact} ${f.detail || ""}`.toLowerCase().includes(query))
      : facts;
    if (filtered.length === 0) continue;

    const section = document.createElement("div");
    section.className = "fund-category";
    section.innerHTML = `<h2>${category}</h2>`;
    for (const f of filtered) {
      const factEl = document.createElement("div");
      factEl.className = "fund-fact";
      factEl.innerHTML = `<p class="fact">${f.fact}</p>${f.detail ? `<p class="detail">${f.detail}</p>` : ""}`;
      section.appendChild(factEl);
    }
    container.appendChild(section);
  }

  if (!container.children.length) {
    container.innerHTML = `<p class="empty-state">No fundamentals match your search.</p>`;
  }
}

let quizState = {
  allQuestions: [],
  category: "all",
  pool: [],
  index: 0,
  score: 0,
  selected: null,
  started: false,
  finished: false,
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadQuiz() {
  try {
    const res = await fetch("gk_quiz_data.json");
    const data = await res.json();
    quizState.allQuestions = data.questions;
  } catch (err) {
    document.getElementById("quiz-body").innerHTML = `<p class="empty-state">Could not load gk_quiz_data.json (${err.message}).</p>`;
  }
}

function startQuiz() {
  const filtered =
    quizState.category === "all"
      ? quizState.allQuestions
      : quizState.allQuestions.filter((q) => q.category === quizState.category);

  if (filtered.length === 0) {
    document.getElementById("quiz-body").innerHTML = `<p class="empty-state">No questions in this category yet.</p>`;
    return;
  }

  quizState.pool = shuffle(filtered);
  quizState.index = 0;
  quizState.score = 0;
  quizState.selected = null;
  quizState.started = true;
  quizState.finished = false;
  renderQuiz();
}

function selectQuizAnswer(optionIndex) {
  if (quizState.selected !== null) return;
  quizState.selected = optionIndex;
  if (optionIndex === quizState.pool[quizState.index].answer) quizState.score++;
  renderQuiz();
}

function nextQuizQuestion() {
  quizState.index++;
  quizState.selected = null;
  if (quizState.index >= quizState.pool.length) quizState.finished = true;
  renderQuiz();
}

function renderQuiz() {
  const body = document.getElementById("quiz-body");

  if (!quizState.started) {
    body.innerHTML = `<p class="empty-state">Pick a category (or "All") and press "Start Quiz".</p>`;
    return;
  }

  if (quizState.finished) {
    const total = quizState.pool.length;
    const pct = Math.round((quizState.score / total) * 100);
    body.innerHTML = `
      <div class="quiz-results">
        <div>You scored</div>
        <div class="score">${quizState.score} / ${total} (${pct}%)</div>
        <button class="quiz-next-btn" id="restart-quiz-btn">Try Again</button>
      </div>
    `;
    document.getElementById("restart-quiz-btn").addEventListener("click", startQuiz);
    return;
  }

  const q = quizState.pool[quizState.index];
  const answered = quizState.selected !== null;

  const optionsHtml = q.options
    .map((opt, i) => {
      let cls = "quiz-option";
      if (answered) {
        if (i === q.answer) cls += " correct";
        else if (i === quizState.selected) cls += " incorrect";
      }
      return `<button class="${cls}" data-option-index="${i}" ${answered ? "disabled" : ""}>${opt}</button>`;
    })
    .join("");

  let explanationHtml = "";
  if (answered) {
    const wasCorrect = quizState.selected === q.answer;
    explanationHtml = `
      <div class="quiz-explanation">
        <span class="verdict ${wasCorrect ? "verdict-correct" : "verdict-incorrect"}">${wasCorrect ? "✓ Correct" : "✗ Incorrect — correct answer: " + q.options[q.answer]}</span>
        ${q.explanation}
      </div>
      <button class="quiz-next-btn" id="quiz-next-btn">${quizState.index + 1 >= quizState.pool.length ? "See Results" : "Next Question →"}</button>
    `;
  }

  body.innerHTML = `
    <div class="quiz-progress">
      <span>Question ${quizState.index + 1} of ${quizState.pool.length}</span>
      <span>Score: ${quizState.score}/${quizState.index + (answered ? 1 : 0)}</span>
    </div>
    <div class="quiz-card">
      <span class="quiz-category-tag">${q.category.replace("-", " ")}</span>
      <p class="quiz-question">${q.question}</p>
      <div class="quiz-options">${optionsHtml}</div>
      ${explanationHtml}
    </div>
  `;

  if (!answered) {
    body.querySelectorAll(".quiz-option").forEach((btn) => {
      btn.addEventListener("click", () => selectQuizAnswer(Number(btn.dataset.optionIndex)));
    });
  } else {
    document.getElementById("quiz-next-btn").addEventListener("click", nextQuizQuestion);
  }
}

function setupQuizControls() {
  document.querySelectorAll("#quiz-category-chips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#quiz-category-chips .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      quizState.category = chip.dataset.quizCategory;
    });
  });

  document.getElementById("start-quiz-btn").addEventListener("click", startQuiz);
  renderQuiz();
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

function setupControls() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.category = chip.dataset.category;
      renderNews();
    });
  });

  const searchInput = document.getElementById("search-input");
  searchInput.addEventListener("input", (e) => {
    state.query = e.target.value;
    renderNews();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchWeb(e.target.value);
  });

  document.getElementById("bookmarked-only").addEventListener("change", (e) => {
    state.bookmarkedOnly = e.target.checked;
    renderNews();
  });

  document.getElementById("refresh-btn").addEventListener("click", () => loadNews(true));
  document.getElementById("clear-search-btn").addEventListener("click", clearWebSearch);
}

setupTabs();
setupControls();
setupQuizControls();
loadNews();
loadFundamentals();
loadQuiz();
