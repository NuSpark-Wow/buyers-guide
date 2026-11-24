// The Buyer's Guide — server function (Vercel) — Learn...Wow! / NuSparkLearnWow
// Unbiased buying education for anything you buy or hire, for your home or your business.
// No brands recommended, no companies ranked, no sponsors.
// One endpoint, several modes:
//   triage — reads the query, picks the right advisor panel for it, and writes clarifying questions (every one can be skipped)
//   report — the full, source-checked Buyer's Guide (learn mode) or a Second Look at a decision (decided mode)
//   panel  — the advisor panel challenges the decision, then the verdict: Confirmed / Confirmed With Conditions / Step Back
//   prices — typical price ranges on request (a button in learn mode; decided mode gets them in the guide)
//   ask    — follow-up questions to Mr. Paul or one advisor; may ask a clarifying question back
// Honesty rule: every source shown is a page Claude actually retrieved with web search during THIS request.

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const FAST_MODEL = process.env.FAST_MODEL || "claude-haiku-5-5";
const DAILY_LIMIT = parseInt(process.env.DAILY_LIVE_LIMIT || "30", 10);
const ALLOWED = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

const SIDES = { home: "FOR HOME (a personal or household purchase or hire)", business: "FOR BUSINESS (a purchase or hire for a company or organization)" };
const STAGES = { learn: "LEARNING (early: wants to understand what to look for)", decided: "DECIDED OR CLOSE (has a choice in mind and wants it confirmed, challenged, or stepped back from)" };
const ICONS = ["🧮", "🛋️", "🔧", "⚖️", "📊", "🏠", "💼", "🛡️", "🔍", "🧰", "📈", "🧾", "🏗️", "💡", "🖥️", "🚗", "🩺", "🌱", "🎯", "🤝"];

// --- simple per-IP daily limit (resets when the server instance restarts; the Anthropic spend cap is the real backstop)
const hits = new Map();
function overLimit(ip, limit) {
  const key = ip + "|" + new Date().toISOString().slice(0, 10);
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) hits.clear();
  return n > limit;
}

const SYSTEM = `You are the editor of "The Buyer's Guide", an unbiased buying-education tool from NuSparkLearnWow.com (part of the Learn...Wow! series from NuSpark Publishing). The host is Mr. Paul, a warm, straight-talking teacher who is always on the buyer's side, never the seller's. People come here before they buy or hire anything, for their home or their business: products (a TV, a sofa bed, a dishwasher, a car, a laptop), software and systems (a CRM, an ERP, accounting or payroll software), and services (a roofing contractor, a lawyer, a financial advisor, a marketing agency, an IT provider). It is like a second opinion from an independent consumer-research desk, more detailed and more honest than a search engine.

WHAT THE TOOL DOES:
- EDUCATES: what the thing is, the main types, what really matters, what is hype, what it really costs over time, the questions to ask, the red flags, and how to check out a seller or provider.
- CONFIRMS OR STEPS BACK: when a visitor shares what they are leaning toward and why, look honestly at their reasoning. Reassure them where it is sound. Say clearly when they should step back, and why. Never just agree to please them.
- CHALLENGES: a panel of advisors who fit the query (for example an interior decorator for a sofa, a fractional CFO for accounting software) pushes back from different angles so the buyer sees what they might be missing.

UNBIASED RULES (the heart of the tool):
1. Never recommend, rank, endorse or compare specific brands, companies, stores, products, models, providers or local businesses. Teach product TYPES, features, standards and what to look for instead (for example "an OLED panel", "a CRM with native email sync", "a fee-only fiduciary advisor").
2. If the visitor asks "which brand is best" or "should I buy brand X", explain kindly that The Buyer's Guide doesn't rank brands, then teach them exactly how to judge any brand themselves.
3. If the visitor names their own choice, refer to it as "your choice" and judge its type, features, terms and fit for their needs. Do not praise or criticize the brand or company itself.
4. Never promote any business, including NuSpark or any NuSpark service. No affiliate-style language, no "deals", no sales pressure.
5. Neutral official tools may be named because they are public verification resources, not sellers: for example FINRA BrokerCheck, the SEC's Investment Adviser Public Disclosure site, state bar lawyer directories, state contractor license lookups, the Better Business Bureau, the CPSC recall database, NHTSA recalls, Energy Star.

HONESTY RULES:
1. Use the web_search tool before answering when it is available. Rely on reliable, independent sources: government agencies (FTC, CFPB, CPSC, SEC, FINRA, Energy Star, NHTSA, state agencies), universities, trade and standards bodies, and established independent publications and testing labs. Avoid manufacturer marketing, affiliate "best of" lists, forums and social media.
2. Every source you list MUST be a URL that appeared in your search results in this conversation. Never invent or guess URLs.
3. Never make anything up. Prices, lifespans and standards change: give price ranges only when your research supports them, label them as typical ranges at the time of research, and say they vary by region and over time. If you are not sure, say so.
4. Weightings, ratings and verdicts are your reasoned judgment from the research. Present them as Mr. Paul's guidance, not as lab measurements.

LEGAL, FINANCIAL AND HEALTH PURCHASES: for lawyers, financial advisors, insurance, investments, tax software, medical devices, health plans and similar, teach what to look for and how to verify credentials, and include a clear note that this is education, not legal, financial or medical advice. Never tell someone to buy, sell or hold an investment.

TOPIC RULES:
- The tool covers anything a person or business buys, leases, subscribes to or hires. If a question is not about buying or hiring, set onTopic to false and kindly suggest The Answer Man on NuSparkLearnWow.com for general questions.
- Do not write guides for weapons or ammunition, illegal drugs, or anything illegal. Kindly decline with onTopic false.
- No "near me" answers and no local business lists. Use national, everyday examples. US measurements and dollars, with metric where it helps.

WRITING STYLE: clear, friendly and confident, like a trusted expert friend who has seen every sales trick. Short sentences. Plain words; explain any term the first time. Be as detailed as the purchase deserves: a big or risky purchase gets more depth than a small one. Never call the tool or its content "free." No markdown, no asterisks, plain sentences.

OUTPUT: Never put citation tags or markup (like <cite ...>) inside the JSON text. After your research, reply with ONLY a JSON object wrapped in <json> and </json> tags, in the exact shape the user message asks for.`;

const ADVICE_NOTE = "This is education, not legal, financial or medical advice. For decisions with legal, tax, investment or health consequences, check with a licensed professional who works for you.";
const sourcesShape = `"sources": [{"title": "Publisher: page title", "url": "https://..."}]`;

function ctx(b) {
  const q = String(b.question || "").slice(0, 400);
  const side = SIDES[b.side] || SIDES.home;
  const stage = STAGES[b.stage] || STAGES.learn;
  const lean = String(b.leaning || "").slice(0, 900);
  const ans = Array.isArray(b.answers) ? b.answers.slice(0, 5) : [];
  const answered = ans.filter(a => a && a.a && !/^skip/i.test(a.a)).map(a => `- ${String(a.q || "").slice(0, 160)} -> ${String(a.a).slice(0, 200)}`).join("\n");
  const skipped = ans.filter(a => a && (!a.a || /^skip/i.test(a.a))).map(a => `- ${String(a.q || "").slice(0, 160)}`).join("\n");
  const extra = String(b.details || "").slice(0, 700);
  return `What they want to buy or hire: "${q}"
Side: ${side}
Stage: ${stage}` +
    (lean ? `\nWhat they are leaning toward, and why (their words): "${lean}"` : "") +
    (answered ? `\nThey answered:\n${answered}` : "") +
    (skipped ? `\nThey were not sure or skipped these (do NOT stop; cover the main possibilities instead):\n${skipped}` : "") +
    (extra ? `\nMore details from them: "${extra}"` : "");
}
const panelText = p => (Array.isArray(p) ? p : []).slice(0, 4).map((a, i) => `${i + 1}. ${String(a.name || "").slice(0, 60)}, ${String(a.role || "").slice(0, 80)}: lens = ${String(a.lens || "").slice(0, 200)}`).join("\n");

function modePrompt(mode, b) {
  if (mode === "triage") {
    return `${ctx(b)}
Set up this Buyer's Guide. Do not research or answer it yet.
1. Decide if it is on topic (buying, leasing, subscribing to or hiring something). If not, or if it is weapons, drugs or anything illegal, set onTopic false.
2. Give it a short, clear title, like "Buying a Sofa Bed" or "Hiring a Financial Advisor" or "Choosing a CRM for a Small Team".
3. Pick the ADVISOR PANEL: 3 or 4 advisors who would really sit at the table for THIS decision, each bringing a different angle. Mix one deep specialist (for example a home theater installer, a roofing inspector, an ERP implementation consultant, a fee-only planner), one money voice (for example a household budget coach, a fractional CFO), one hands-on voice (for example an interior decorator, an operations manager, a long-time owner), and one skeptic who pushes back on everything (for example a consumer protection investigator, a procurement officer). Give each a friendly role title only, never a personal name. Each gets one emoji icon.
4. Write CLARIFYING QUESTIONS that would change the advice: at most 4, each short, with 2-5 tap options. Visitors can skip any of them and the guide still runs, so ask only what truly matters (for example room size and viewing distance for a TV; team size and current tools for a CRM; roof age and material for a roofer). ${b.stage === "decided" ? "They have a choice in mind, so ask what would most help judge it (budget, how long they plan to keep it, must-haves, timeline)." : ""} Never ask for personal information like names, addresses or account numbers.
Reply with ONLY this JSON inside <json></json>:
{"onTopic": true,
 "message": "if onTopic is false, one kind sentence explaining and pointing to The Answer Man for general questions; otherwise empty",
 "title": "short guide title (max 8 words)",
 "kind": "product | software | service",
 "sensitive": false,
 "panel": [{"name": "role title, e.g. Interior Decorator", "role": "one short line on what they bring", "lens": "the angle they will push on", "icon": "one emoji"}],
 "questions": [{"q": "short question", "options": ["2-5 short choices"]}]}
Set "sensitive" to true for legal, financial, insurance, investment, tax or health purchases.`;
  }

  if (mode === "report") {
    const decided = b.stage === "decided";
    const style = b.style === "extended"
      ? `LENGTH: EXTENDED (double length). Go deep everywhere: 5-6 types, 8-10 factors, 6-8 hype items, 10-12 questions, 8-10 red flags, and 4 "deeper" sections of 5-7 sentences each (for example how it works inside, how the industry prices it, what changed in recent years, and how to negotiate).`
      : `LENGTH: FULL. 3-5 types, 6-8 factors, 4-6 hype items, 8-10 questions, 6-8 red flags, and 2 "deeper" sections of 4-6 sentences each.`;
    return `${ctx(b)}
${style}
Research this purchase with web search (several searches: what experts and independent testers say matters, ${decided ? "current typical price ranges, " : ""}common problems and complaints, and how to verify a seller or provider when it applies). Then write the Buyer's Guide.
${decided ? `They are DECIDED OR CLOSE. Fill "yourChoice" with an honest second look at their choice and reasoning: what is sound, what concerns you, and what to confirm before they commit. Be fair and direct.` : `They are LEARNING. Leave "yourChoice" as null.`}
If they skipped clarifying questions, fill "covering" with if-then guidance for the main possibilities (for example "If your room is small (under 10 feet of viewing distance), then..."). If they skipped nothing, "covering" can be empty.
"mattersMost" weights are 1-10 for how much each factor should drive THIS buyer's decision (10 = deal-breaker level).
"types" compares the main kinds or approaches (never brands). Use short cells.
"path" is a decision flowchart: 4-6 yes/no checkpoints in order, each with what to do if the answer is no.
${decided ? "" : `They are LEARNING, so leave "prices" as an empty list and "priceNote" empty: price ranges are shown only if they ask. Still fill "costs" (what kinds of costs to expect, without dollar figures) and "lifespan".`}
"verify" lists how to check out the seller or provider (licenses, credentials, insurance, complaint records, official lookups by name); for simple products it can cover return policies, warranties and recall checks instead.
Reply with ONLY this JSON inside <json></json>:
{"ok": true,
 "title": "guide title",
 "quickTake": "5-7 sentences that answer the big question right away: what matters most for this buyer and the one mistake to avoid",
 "whatItIs": "3-5 sentences explaining what it is and how it works, for a beginner",
 "types": [{"name": "type or approach", "bestFor": "who it fits", "strengths": "short", "watchOut": "short", "cost": "$ | $$ | $$$ | $$$$"}],
 "mattersMost": [{"factor": "short factor name", "weight": 8, "why": "1-2 sentences"}],
 "hype": [{"claim": "what the ad or salesperson says", "reality": "what it really means"}],
 "prices": [{"tier": "a 1-3 word label only, e.g. Budget, Mid-range, Premium", "range": "the typical range only, short, e.g. $600 to $1,200 or $4.50 to $9 per sq ft", "get": "what that money usually gets you, including the type or material"}],
 "priceNote": "1 sentence: when and where these ranges come from, and that they vary",
 "costs": {"upfront": ["what you pay at the start"], "ongoing": ["what you keep paying"], "hidden": ["costs people forget"]},
 "lifespan": {"years": "typical useful life in one short phrase, e.g. 7 to 10 years; if it differs by type, keep it brief, e.g. 15 to 30 years depending on type", "note": "one sentence on what shortens or extends it"},
 "questions": ["questions to ask the seller, salesperson or provider"],
 "redFlags": ["warning signs to walk away from"],
 "verify": ["how to check them out, naming official public lookups where they exist"],
 "timing": "2-4 sentences on when to buy or hire, only what the research supports (seasonal patterns, model cycles, lead times); empty if timing doesn't matter",
 "mistakes": ["4-6 common regrets buyers have"],
 "yourChoice": ${decided ? `{"summary": "2-3 sentences on their choice and reasoning", "sound": ["what is solid about it"], "concerns": ["what worries you"], "confirm": ["what to confirm before committing"]}` : "null"},
 "covering": [{"if": "if this is your situation", "then": "then do or look for this"}],
 "path": [{"q": "a yes/no checkpoint question", "no": "what to do if the answer is no"}],
 "deeper": [{"heading": "short heading", "text": "section text"}],
 "followups": ["4 short follow-up questions a buyer might ask next"],
 "wiki": "the exact English Wikipedia article title that best pictures the item or service, e.g. 'Sofa bed', 'Customer relationship management', 'Roofer'",
 ${sourcesShape}}`;
  }

  if (mode === "panel") {
    const decided = b.stage === "decided";
    return `${ctx(b)}
Guide title: "${String(b.title || "").slice(0, 160)}"
Summary of the research so far: ${String(b.summary || "").slice(0, 3000)}
The advisor panel for this decision:
${panelText(b.panel)}
Each advisor now challenges ${decided ? "the visitor's choice and reasoning" : "the visitor's plan to buy this, and the common assumptions buyers make"}, from their own lens and in their own voice. They do not all agree. At least one must push back hard. They stay unbiased: no brands, no companies, no promotion.
Then Mr. Paul weighs the panel and gives the verdict.
${decided
  ? `Verdict options: "confirmed" (their choice and reasoning hold up), "conditions" (confirmed, but only if they check specific things first), "stepback" (they should pause and rethink, with clear reasons and what to consider instead). Be honest. Do not default to "confirmed" to please them.`
  : `Verdict options: "confirmed" (they are ready to shop with what they now know), "conditions" (ready to shop, but settle these questions first), "stepback" (slow down; something important needs thinking through before they shop, for example whether they need it at all, or a cheaper path such as repair, renting, used or refurbished, or waiting).`}
"stance" is each advisor's position from -2 (strongly against / step back) to 2 (strongly for / go ahead).
Reply with ONLY this JSON inside <json></json>:
{"advisors": [{"name": "exactly the advisor's role title from the list", "stance": 1, "headline": "their one-line position", "argument": "3-5 sentences in their voice, specific to this buyer", "question": "the one question they want the buyer to answer honestly"}],
 "verdict": "confirmed | conditions | stepback",
 "verdictTitle": "a short, plain verdict headline",
 "reasons": ["3-4 reasons for the verdict"],
 "conditions": ["things to check or settle first (for conditions or stepback); empty for confirmed"],
 "finalWord": "2-3 sentences from Mr. Paul, warm and direct, on the buyer's side"}`;
  }

  if (mode === "prices") {
    return `${ctx(b)}
Guide title: "${String(b.title || "").slice(0, 160)}"
The visitor wants general price estimates. Research current typical price ranges with web search, using independent sources (government, trade associations, established publications and cost guides), not seller pages or lead-generation marketplaces.
Give 3 or 4 tiers, never brands. Keep "tier" to a 1-3 word label, "range" short, and put the type or material in "get". Say plainly in "priceNote" when the ranges come from, that sources disagree if they do, and that prices vary by region, size and over time. Add 2-4 short "drivers": what pushes the price up or down.
Reply with ONLY this JSON inside <json></json>:
{"prices": [{"tier": "Budget", "range": "$600 to $1,200", "get": "what that money usually gets you"}], "priceNote": "one sentence", "drivers": ["what moves the price"], ${sourcesShape}}`;
  }

  if (mode === "ask") {
    const to = String(b.to || "Mr. Paul").slice(0, 60);
    const hist = (Array.isArray(b.history) ? b.history : []).slice(-6).map(h => `Visitor: ${String(h.q || "").slice(0, 300)}\n${String(h.who || "Mr. Paul")}: ${String(h.a || "").slice(0, 700)}`).join("\n\n");
    return `${ctx(b)}
Guide title: "${String(b.title || "").slice(0, 160)}"
Guide summary: ${String(b.summary || "").slice(0, 2000)}
The advisor panel:
${panelText(b.panel)}
${hist ? `Conversation so far:\n${hist}\n` : ""}
The visitor asks ${to === "Mr. Paul" ? "Mr. Paul" : "the " + to}: "${String(b.q || "").slice(0, 700)}"
Answer in ${to === "Mr. Paul" ? "Mr. Paul's" : "that advisor's"} voice, staying unbiased (no brands, no companies, no promotion). Research with web search if the answer depends on facts, prices, standards or rules. Answer in 1-3 short paragraphs. If one missing detail would change the answer, answer what you can and put one short clarifying question in "clarify".
Reply with ONLY this JSON inside <json></json>:
{"who": "${to}", "text": "the answer", "clarify": "one short question, or empty", ${sourcesShape}}`;
  }
  return null;
}

// ---------- helpers
function normUrl(u) {
  try { const x = new URL(String(u).trim()); return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase(); }
  catch (e) { return ""; }
}
function hostOf(u) { try { return new URL(String(u).trim()).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return ""; } }
const words = t => new Set(String(t || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));

// strong-source filter: official, standards, independent testing and established publications only (no affiliate "best of" farms, no sellers)
const STRONG_SUFFIX = [".edu", ".gov", ".mil", ".int", ".ac.uk", ".gov.uk", ".gc.ca", ".edu.au", ".gov.au"];
const STRONG_HOSTS = [
  // consumer protection, finance and legal verification
  "consumer.ftc.gov", "ftc.gov", "consumerfinance.gov", "finra.org", "brokercheck.finra.org", "sec.gov", "investor.gov", "adviserinfo.sec.gov", "naic.org", "iii.org", "cfp.net", "napfa.org",
  "americanbar.org", "nolo.com", "bbb.org", "usa.gov", "sba.gov", "score.org", "irs.gov", "investopedia.com", "aicpa-cima.com", "journalofaccountancy.com", "kiplinger.com",
  // safety, energy and standards
  "cpsc.gov", "saferproducts.gov", "energystar.gov", "energy.gov", "epa.gov", "nhtsa.gov", "iihs.org", "fueleconomy.gov", "nfpa.org", "ul.com", "osha.gov", "fema.gov", "ready.gov", "hud.gov",
  // home and trades
  "nrca.net", "nari.org", "nahb.org", "ashi.org", "thisoldhouse.com", "familyhandyman.com", "bobvila.com", "finehomebuilding.com", "popularmechanics.com", "goodhousekeeping.com", "consumerreports.org",
  "thespruce.com", "bhg.com", "architecturaldigest.com", "housebeautiful.com", "sleepfoundation.org", "aham.org",
  // tech and software
  "rtings.com", "cnet.com", "pcmag.com", "pcworld.com", "zdnet.com", "techradar.com", "tomsguide.com", "tomshardware.com", "theverge.com", "wired.com", "arstechnica.com", "howtogeek.com", "lifewire.com",
  "techtarget.com", "cio.com", "computerworld.com", "infoworld.com", "gartner.com", "forrester.com", "g2.com", "trustradius.com", "hbr.org", "shrm.org", "inc.com", "entrepreneur.com", "fastcompany.com",
  // cars
  "edmunds.com", "kbb.com", "caranddriver.com", "motortrend.com", "aaa.com", "jdpower.com",
  // general reference and news
  "britannica.com", "howstuffworks.com", "wikipedia.org", "en.wikipedia.org", "nytimes.com", "wirecutter.com", "washingtonpost.com", "wsj.com", "reuters.com", "apnews.com", "npr.org", "pbs.org", "bbc.com", "bbc.co.uk",
  "cnbc.com", "bloomberg.com", "usatoday.com", "theguardian.com", "forbes.com", "money.com", "mayoclinic.org", "clevelandclinic.org", "aarp.org"
];
function isStrong(url) {
  const h = hostOf(url); if (!h) return false;
  if (STRONG_SUFFIX.some(sfx => h.endsWith(sfx))) return true;
  return STRONG_HOSTS.some(d => h === d || h.endsWith("." + d));
}
// A source counts only if it is a page Claude actually retrieved in THIS request.
function verifySources(list, retrieved) {
  const out = [], seen = new Set(), pages = [...retrieved.values()];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || !s.url) continue;
    let r = retrieved.get(normUrl(s.url));
    if (!r) {
      const host = hostOf(s.url), want = words((s.title || "") + " " + s.url);
      let best = null, bestScore = -1;
      for (const pg of pages) {
        if (hostOf(pg.url) !== host) continue;
        const have = words(pg.title + " " + pg.url);
        let score = 0; want.forEach(w => { if (have.has(w)) score++; });
        if (score > bestScore) { best = pg; bestScore = score; }
      }
      r = best;
    }
    if (!r || !isStrong(r.url) || /[?&]comment/i.test(r.url)) continue;
    const n = normUrl(r.url), t = hostOf(r.url).replace(/^www\./, "") + "|" + String(r.title || s.title || "").toLowerCase().trim();
    if (seen.has(n) || seen.has(t)) continue;
    seen.add(n); seen.add(t);
    out.push({ title: String(r.title || s.title || r.url).slice(0, 200), url: r.url });
  }
  return out.slice(0, 8);
}
function extractJson(text) {
  let raw = null;
  const low = text.toLowerCase();
  for (let i = low.lastIndexOf("<json>"); i >= 0; i = low.lastIndexOf("<json>", i - 1)) {
    const end = low.indexOf("</json>", i);
    if (end > i) { raw = text.slice(i + 6, end); break; }
    if (i === 0) break;
  }
  if (!raw) { const a = text.indexOf("{"), z = text.lastIndexOf("}"); if (a >= 0 && z > a) raw = text.slice(a, z + 1); }
  if (!raw) return null;
  raw = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(raw); } catch (e) { return null; }
}
const cleanText = s => String(s || "").replace(/<\/?cite\b[^>]*>/gi, "").replace(/<\/?[a-z_]+:[a-z_]+\b[^>]*>/gi, "").replace(/\*\*/g, "").replace(/[ \t]{2,}/g, " ").trim();
const clip = (s, n) => cleanText(s).slice(0, n);
const clipList = (a, n, len) => (Array.isArray(a) ? a : []).slice(0, n).map(x => clip(x, len)).filter(Boolean);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

function cleanPanel(a) {
  const seen = new Set();
  return (Array.isArray(a) ? a : []).slice(0, 4).map((p, i) => ({
    name: clip(p && p.name, 50), role: clip(p && p.role, 120), lens: clip(p && p.lens, 200),
    icon: (String(p && p.icon || "").trim().slice(0, 4)) || ICONS[i % ICONS.length]
  })).filter(p => p.name && !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()));
}

async function anthropic(messages, maxSearches, model, maxTokens) {
  const body = { model: model || MODEL, max_tokens: maxTokens || 10000, system: SYSTEM, messages };
  // the fast model must have thinking turned off, or it spends its whole budget thinking and returns nothing
  if (/haiku/i.test(body.model)) body.thinking = { type: "disabled" };
  if (maxSearches > 0) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text(); throw new Error("Anthropic API error " + r.status + ": " + t.slice(0, 300)); }
  return r.json();
}
const textOf = data => (data.content || []).filter(c => c.type === "text").map(c => c.text).join("");

async function callClaude(userPrompt, maxSearches, maxTokens) {
  const messages = [{ role: "user", content: userPrompt }];
  const retrieved = new Map();
  let finalText = "";
  const absorb = data => {
    for (const block of data.content || []) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const res of block.content) if (res && res.url) retrieved.set(normUrl(res.url), { url: res.url, title: res.title || "" });
      }
      if (block.type === "text") {
        finalText += block.text;
        for (const c of block.citations || []) if (c && c.url) retrieved.set(normUrl(c.url), { url: c.url, title: c.title || "" });
      }
    }
  };
  let data = null;
  for (let round = 0; round < 4; round++) {
    data = await anthropic(messages, maxSearches, MODEL, maxTokens);
    absorb(data);
    if (data.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: data.content }); continue; }
    break;
  }
  if (!extractJson(finalText) && data) {
    messages.push({ role: "assistant", content: data.content });
    messages.push({ role: "user", content: "Thank you. Now reply with ONLY the final <json>...</json> object in the exact shape requested, using only the pages you already found. Do not search again." });
    try { finalText = ""; const d2 = await anthropic(messages, 1, MODEL, maxTokens); absorb(d2); } catch (e) { console.error(e); }
  }
  return { text: finalText, retrieved };
}

const NO_SOURCES = "Mr. Paul couldn't match this guide to strong independent sources this time, so treat it as general guidance and double-check anything important before you buy.";

module.exports = async (req, res) => {
  if (!(await require("./_lwgate")(req, res, "buyers-guide"))) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const origin = req.headers.origin || "";
  if (ALLOWED.length && origin && !ALLOWED.some(a => origin === a)) return res.status(403).json({ error: "This tool only works on its home website." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "x").split(",")[0].trim();
  const b = req.body || {};
  const mode = String(b.mode || "");
  if (mode !== "triage" && overLimit(ip, DAILY_LIMIT)) {
    return res.status(429).json({ error: "limit", message: "You've reached today's limit. Come back tomorrow and the panel will be ready." });
  }
  const prompt = modePrompt(mode, b);
  if (!prompt) return res.status(400).json({ error: "Unknown mode" });

  try {
    if (mode === "triage") {
      const j = extractJson(textOf(await anthropic([{ role: "user", content: prompt }], 0, FAST_MODEL, 1800))) || {};
      if (j.onTopic === false) return res.status(200).json({ onTopic: false, message: clip(j.message, 300) || "The Buyer's Guide is for things you buy or hire. For other questions, try The Answer Man on NuSparkLearnWow.com." });
      let panel = cleanPanel(j.panel);
      if (panel.length < 3) panel = panel.concat(cleanPanel([
        { name: "Budget Coach", role: "Keeps the money honest", lens: "total cost and value", icon: "🧮" },
        { name: "Long-Time Owner", role: "Has lived with this decision", lens: "what it's like in year three", icon: "🏠" },
        { name: "Consumer Protection Investigator", role: "Has seen every trick", lens: "red flags and fine print", icon: "🔍" }
      ]).filter(p => !panel.some(x => x.name.toLowerCase() === p.name.toLowerCase()))).slice(0, 4);
      const questions = (Array.isArray(j.questions) ? j.questions : []).slice(0, 4)
        .map(q => ({ q: clip(q && q.q, 160), options: clipList(q && q.options, 5, 60) })).filter(q => q.q && q.options.length >= 2);
      return res.status(200).json({
        onTopic: true, title: clip(j.title, 90) || clip(b.question, 90), kind: oneOf(j.kind, ["product", "software", "service"], "product"),
        sensitive: j.sensitive === true, panel, questions
      });
    }

    if (mode === "panel") {
      const j = extractJson(textOf(await anthropic([{ role: "user", content: prompt }], 0, MODEL, 5000))) || {};
      const names = cleanPanel(b.panel).map(p => p.name);
      const advisors = (Array.isArray(j.advisors) ? j.advisors : []).slice(0, 4).map((a, i) => ({
        name: names.find(n => n.toLowerCase() === String(a && a.name || "").toLowerCase().trim()) || names[i] || clip(a && a.name, 50),
        stance: Math.max(-2, Math.min(2, Math.round(Number(a && a.stance) || 0))),
        headline: clip(a && a.headline, 200), argument: clip(a && a.argument, 1200), question: clip(a && a.question, 300)
      })).filter(a => a.name && a.argument);
      if (!advisors.length) return res.status(200).json({ ok: false, message: "The panel couldn't meet just now. Tap Try Again." });
      return res.status(200).json({
        ok: true, advisors, verdict: oneOf(j.verdict, ["confirmed", "conditions", "stepback"], "conditions"),
        verdictTitle: clip(j.verdictTitle, 140), reasons: clipList(j.reasons, 5, 400), conditions: clipList(j.conditions, 6, 300), finalWord: clip(j.finalWord, 700)
      });
    }

    // ---- researched modes
    const searches = mode === "report" ? (b.style === "extended" ? 7 : (b.stage === "decided" ? 5 : 4)) : mode === "prices" ? 3 : 2;
    const { text, retrieved } = await callClaude(prompt, searches, mode === "report" ? (b.style === "extended" ? 16000 : 11000) : 3000);
    const j = extractJson(text) || {};
    const sources = verifySources(j.sources, retrieved);

    if (mode === "report") {
      if (j.ok === false) return res.status(200).json({ ok: false, message: clip(j.quickTake || j.message, 400) || "The Buyer's Guide is for things you buy or hire. For other questions, try The Answer Man on NuSparkLearnWow.com." });
      if (!j.quickTake) return res.status(200).json({ ok: false, message: "Mr. Paul couldn't put that guide together just now. Please try again in a minute." });
      const yc = j.yourChoice && typeof j.yourChoice === "object" ? {
        summary: clip(j.yourChoice.summary, 800), sound: clipList(j.yourChoice.sound, 6, 300), concerns: clipList(j.yourChoice.concerns, 6, 300), confirm: clipList(j.yourChoice.confirm, 6, 300)
      } : null;
      const costs = j.costs && typeof j.costs === "object" ? j.costs : {};
      return res.status(200).json({
        ok: true, title: clip(j.title, 140), quickTake: clip(j.quickTake, 1600), whatItIs: clip(j.whatItIs, 1200),
        types: (Array.isArray(j.types) ? j.types : []).slice(0, 6).map(t => ({ name: clip(t && t.name, 80), bestFor: clip(t && t.bestFor, 200), strengths: clip(t && t.strengths, 200), watchOut: clip(t && t.watchOut, 200), cost: (String(t && t.cost || "").match(/^\${1,4}$/) || [""])[0] })).filter(t => t.name),
        mattersMost: (Array.isArray(j.mattersMost) ? j.mattersMost : []).slice(0, 10).map(m => ({ factor: clip(m && m.factor, 90), weight: Math.max(1, Math.min(10, Math.round(Number(m && m.weight) || 5))), why: clip(m && m.why, 400) })).filter(m => m.factor).sort((a, b2) => b2.weight - a.weight),
        hype: (Array.isArray(j.hype) ? j.hype : []).slice(0, 8).map(h => ({ claim: clip(h && h.claim, 200), reality: clip(h && h.reality, 400) })).filter(h => h.claim && h.reality),
        prices: (b.stage === "decided" && Array.isArray(j.prices) ? j.prices : []).slice(0, 4).map(p => ({ tier: clip(p && p.tier, 90), range: clip(p && p.range, 180), get: clip(p && p.get, 400) })).filter(p => p.tier && p.range),
        priceNote: clip(j.priceNote, 300),
        costs: { upfront: clipList(costs.upfront, 6, 200), ongoing: clipList(costs.ongoing, 6, 200), hidden: clipList(costs.hidden, 6, 200) },
        lifespan: { years: clip(j.lifespan && j.lifespan.years, 220), note: clip(j.lifespan && j.lifespan.note, 400) },
        questions: clipList(j.questions, 12, 300), redFlags: clipList(j.redFlags, 10, 300), verify: clipList(j.verify, 8, 300),
        timing: clip(j.timing, 700), mistakes: clipList(j.mistakes, 6, 300), yourChoice: b.stage === "decided" ? yc : null,
        covering: (Array.isArray(j.covering) ? j.covering : []).slice(0, 6).map(c => ({ if: clip(c && c.if, 240), then: clip(c && c.then, 400) })).filter(c => c.if && c.then),
        path: (Array.isArray(j.path) ? j.path : []).slice(0, 6).map(p => ({ q: clip(p && p.q, 160), no: clip(p && p.no, 240) })).filter(p => p.q),
        deeper: (Array.isArray(j.deeper) ? j.deeper : []).slice(0, 4).map(d => ({ heading: clip(d && d.heading, 80), text: clip(d && d.text, 1500) })).filter(d => d.text),
        followups: clipList(j.followups, 4, 140), wiki: clip(j.wiki, 120),
        sources, sourceNote: sources.length ? "" : NO_SOURCES, adviceNote: b.sensitive ? ADVICE_NOTE : ""
      });
    }
    if (mode === "prices") {
      const prices = (Array.isArray(j.prices) ? j.prices : []).slice(0, 4).map(p => ({ tier: clip(p && p.tier, 90), range: clip(p && p.range, 180), get: clip(p && p.get, 400) })).filter(p => p.tier && p.range);
      if (!prices.length) return res.status(200).json({ ok: false, message: "Mr. Paul couldn't confirm current price ranges just now. Try again in a minute." });
      return res.status(200).json({ ok: true, prices, priceNote: clip(j.priceNote, 400), drivers: clipList(j.drivers, 4, 240), sources, sourceNote: sources.length ? "" : NO_SOURCES });
    }
    if (mode === "ask") {
      const textA = clip(j.text, 2400);
      if (!textA) return res.status(200).json({ who: clip(b.to, 60) || "Mr. Paul", text: "The panel couldn't confirm an answer to that one. Try asking it a different way.", clarify: "", sources: [] });
      return res.status(200).json({ who: clip(j.who, 60) || clip(b.to, 60) || "Mr. Paul", text: textA, clarify: clip(j.clarify, 200), sources });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "The research desk couldn't connect just now. Please try again in a minute." });
  }
};
