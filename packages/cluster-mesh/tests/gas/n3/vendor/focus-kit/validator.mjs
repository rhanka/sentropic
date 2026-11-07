/*!
MIT License

Copyright (c) 2025 Fabien Antoine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

// packages/focus/src/model.ts
var isEvidenceDossier = (doc) => "schemaVersion" in doc && doc.schemaVersion === 2;

// packages/focus/src/validation/readability.ts
var READABILITY_BUDGETS = { low: 2, medium: 8, high: 30 };
var READABILITY_LIMITS = {
  minOwnerRequestQuoteLength: 8,
  minStakesLength: 20,
  minQuestionContextLength: 20,
  minOptionsPerQuestion: 2,
  maxOptionsPerQuestion: 4,
  maxQuestionReadingMinutes: 2,
  maxDossierBudgetMinutes: 30,
  wordsPerMinute: 180,
  maxHeadingLength: 100,
  maxDecisionLineLength: 300,
  maxOptionLabelLength: 100,
  maxConsequenceLength: 160,
  maxOptionBodyLength: 300
};
var CODE_PATTERN = /\b(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z][A-Z0-9]*\d[A-Z0-9]*[a-z]?|[A-Z]{2,})\b/g;
var PLAIN_TOKENS = /* @__PURE__ */ new Set(["GO", "NO-GO", "NO", "PENDING", "DEFERRED", "LR", "RL", "TB", "BT", "TD", "UTF-8"]);
var CHOICE_PATTERN = /\beither\b[\s\S]{0,160}?\bor\b|\bsoit\b[\s\S]{0,160}?\bsoit\b|\b(?:instead of|rather than|plut[oô]t que|versus|vs\.?|choos(?:e|ing) between|choisir entre)\b/i;
var SUBOPTION_PATTERN = /(?:^|[\n\r\u2028\u2029])\s*(?:[-*+•‣>]|\d+[.)]|[a-z][.)])\s+\S|\([a-z]\)[\s\S]*\([a-z]\)|\b(?:sub[- ]?options?|sous[- ]?options?)\b/i;
var LINE_BREAK = /[\n\r\u2028\u2029]/;
var blank = (text2) => !text2?.trim();
var asRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var minutesFor = (texts) => (texts.join(" ").match(/\S+/gu)?.length ?? 0) / READABILITY_LIMITS.wordsPerMinute;
var validateDecisionDossierReadability = (doc) => {
  const issues = [];
  const refuse = (path, code, message) => {
    issues.push({ path, code, message });
  };
  const r = doc.readability;
  const quote = r?.ownerRequestQuote?.trim() ?? "";
  if (r?.noOwnerRequest === true) {
    refuse(
      "$.readability.noOwnerRequest",
      quote ? "conflicting_owner_request" : "presentation_blocked",
      quote ? "A quoted owner request conflicts with noOwnerRequest: keep the literal request and remove the flag." : "No owner request: presentation is blocked until the owner's literal request is quoted."
    );
  } else if (!quote) {
    refuse("$.readability.ownerRequestQuote", "missing_owner_request", "Quote the literal owner request this dossier serves, or set noOwnerRequest to block presentation explicitly.");
  } else if (quote.length < READABILITY_LIMITS.minOwnerRequestQuoteLength) {
    refuse("$.readability.ownerRequestQuote", "owner_request_too_short", "Quote the full literal owner request so the owner recognizes their own intention.");
  }
  if (blank(r?.stakes)) {
    refuse("$.readability.stakes", "missing_stakes", "State why the decision matters to the owner, using plain words about cost, time or consequences.");
  } else if (r.stakes.trim().length < READABILITY_LIMITS.minStakesLength) {
    refuse("$.readability.stakes", "stakes_too_short", "Explain the actual consequence for the owner in at least 20 characters; an internal label is insufficient.");
  }
  const level = r?.stakesLevel;
  if (!level || !Object.hasOwn(READABILITY_BUDGETS, level)) {
    refuse("$.readability.stakesLevel", "missing_stakes_level", "Declare stakesLevel: low for a small reversible inconvenience, medium for cost/disruption, high for lasting or major impact.");
  }
  const budget = r?.readingBudgetMinutes;
  const budgetValid = budget !== void 0 && Number.isFinite(budget) && budget >= 1 && budget <= READABILITY_LIMITS.maxDossierBudgetMinutes;
  if (budget === void 0) {
    refuse("$.readability.readingBudgetMinutes", "missing_reading_budget", "Declare a total reading budget in minutes proportionate to the stakes: low up to 2, medium up to 8, high up to 30.");
  } else if (!budgetValid) {
    refuse("$.readability.readingBudgetMinutes", "reading_budget_out_of_range", "The total reading budget must be a finite number between 1 and 30 minutes.");
  } else if (level && Object.hasOwn(READABILITY_BUDGETS, level) && budget > READABILITY_BUDGETS[level]) {
    refuse("$.readability.readingBudgetMinutes", "reading_budget_disproportionate", `The ${level} stakes budget is at most ${READABILITY_BUDGETS[level]} minutes; shorten this dossier or justify a different stakes level.`);
  }
  const glossary = /* @__PURE__ */ new Map();
  r?.glossary?.forEach((entry, i) => {
    if (blank(entry.term) || blank(entry.definition)) {
      refuse(`$.readability.glossary[${i}]`, "empty_glossary_entry", "Give every glossary term a definition in plain words visible to the reader.");
    } else {
      const term = entry.term.trim();
      if (glossary.has(term) || entry.definition.trim() === term) {
        refuse(`$.readability.glossary[${i}]`, "invalid_glossary_entry", "Use one definition per term and expand its meaning; repeating the code does not explain it.");
      }
      if ((entry.definition.match(CODE_PATTERN) ?? []).some((code) => !PLAIN_TOKENS.has(code))) {
        refuse(
          `$.readability.glossary[${i}].definition`,
          "invalid_glossary_entry",
          "Explain each term independently in plain words, without itself or another code, even one defined elsewhere."
        );
      }
      glossary.set(term, entry.definition);
    }
  });
  const checkCodes = (text2, path) => {
    for (const code of new Set(text2?.match(CODE_PATTERN) ?? [])) {
      if (!PLAIN_TOKENS.has(code) && !glossary.has(code)) {
        refuse(path, "undefined_code", `Unexpanded code or acronym "${code}": define it in the visible glossary in plain words, or rewrite it.`);
      }
    }
  };
  const shared = [];
  const visible = (text2, path) => {
    checkCodes(text2, path);
    if (text2) shared.push(text2);
  };
  if (isEvidenceDossier(doc)) {
    doc.sources.forEach((s, i) => {
      checkCodes(s.title, `$.sources[${i}].title`);
      checkCodes(s.alt, `$.sources[${i}].alt`);
    });
    doc.citations.forEach((c, i) => {
      checkCodes(c.label, `$.citations[${i}].label`);
      if (c.locator.kind === "image") checkCodes(c.locator.caption, `$.citations[${i}].locator.caption`);
    });
    doc.evidenceGroups.forEach((g, i) => visible(g.summary, `$.evidenceGroups[${i}].summary`));
    doc.annexes.forEach((a, i) => {
      visible(a.title, `$.annexes[${i}].title`);
      visible(a.summary, `$.annexes[${i}].summary`);
      a.blocks.forEach((b, j) => {
        const path = `$.annexes[${i}].blocks[${j}]`;
        if (b.kind === "text") checkCodes(b.text, `${path}.text`);
        if (b.kind === "table") [...b.columns, ...b.rows.flat()].forEach((t) => checkCodes(t, path));
      });
    });
  }
  for (const field of ["title", "subject"]) {
    visible(doc[field], `$.${field}`);
    if (blank(doc[field])) refuse(
      `$.${field}`,
      "empty_heading",
      "Name the subject and decision in a short, non-empty line the owner understands."
    );
    checkLine(doc[field], `$.${field}`, READABILITY_LIMITS.maxHeadingLength);
  }
  visible(quote, "$.readability.ownerRequestQuote");
  visible(r?.stakes, "$.readability.stakes");
  r?.glossary?.forEach((entry, i) => {
    shared.push(entry.term);
    visible(entry.definition, `$.readability.glossary[${i}].definition`);
  });
  const checkSteps = (steps, path) => {
    steps.forEach((step, i) => {
      visible(step.author, `${path}[${i}].author`);
      visible(step.summary, `${path}[${i}].summary`);
    });
  };
  checkSteps(doc.amendmentTrace, "$.amendmentTrace");
  doc.interactions.forEach((action, i) => visible(action.label, `$.interactions[${i}].label`));
  const questions = doc.sections.filter((s) => s.kind === "question");
  const questionIds = new Set(questions.map((q) => q.id));
  if (!questions.length) refuse("$.sections", "missing_question", "A decision dossier needs an explicit question with context, options and a recommendation.");
  const checkQuestionRef = (questionId, path, required) => {
    if (blank(questionId)) {
      if (required) refuse(path, "hidden_decision", "This content implies a choice without an explicit question: set questionId to the question the owner must answer.");
    } else if (!questionIds.has(questionId)) {
      refuse(path, "unknown_question_ref", `Question "${questionId}" does not exist in this dossier; link to an explicit question.`);
    }
  };
  const optionSets = doc.sections.filter((s) => s.kind === "optionSet");
  let totalQuestionMinutes = 0;
  doc.sections.forEach((section, i) => {
    const path = `$.sections[${i}]`;
    switch (section.kind) {
      case "prose":
        visible(section.markdown, `${path}.markdown`);
        checkQuestionRef(section.questionId, `${path}.questionId`, CHOICE_PATTERN.test(section.markdown));
        break;
      case "outcome":
        visible(section.statement, `${path}.statement`);
        checkQuestionRef(section.questionId, `${path}.questionId`, section.modality !== "comment" || CHOICE_PATTERN.test(section.statement));
        break;
      case "diagram":
        visible(section.alt, `${path}.alt`);
        if (section.scene === void 0) visible(section.source, `${path}.source`);
        else checkCodes(section.source, `${path}.source`);
        for (const [family, field] of [["entities", "name"], ["relations", "label"]]) {
          for (const [id, member] of Object.entries(asRecord(section.scene?.[family]))) {
            const attribute = asRecord(asRecord(asRecord(member).attributes)[field]);
            if (attribute.kind === "text" && typeof attribute.value === "string") {
              visible(attribute.value, `${path}.scene.${family}.${id}.attributes.${field}.value`);
            }
          }
        }
        break;
      case "amendmentTrace":
        checkSteps(section.steps, `${path}.steps`);
        break;
      case "optionSet":
        checkQuestionRef(section.questionId, `${path}.questionId`, true);
        checkCodes(section.title, `${path}.title`);
        checkLine(section.title, `${path}.title`, READABILITY_LIMITS.maxHeadingLength);
        section.options.forEach((option, j) => checkOption(option, `${path}.options[${j}]`));
        break;
      case "question": {
        if (blank(section.question)) refuse(`${path}.question`, "empty_question", "State the explicit decision the owner needs to make in this question.");
        if (blank(section.context)) {
          refuse(`${path}.context`, "missing_question_context", "Add representative context in plain words so the question can be understood on its own.");
        } else if (section.context.trim().length < READABILITY_LIMITS.minQuestionContextLength) {
          refuse(`${path}.context`, "question_context_too_short", "Give representative context of at least 20 characters, including what changes for the owner.");
        }
        if (blank(section.recommendedAnswer)) refuse(`${path}.recommendedAnswer`, "missing_recommendation", "Recommend an option with a short reason that relates to the owner's request and stakes.");
        checkLine(section.question, `${path}.question`, READABILITY_LIMITS.maxDecisionLineLength);
        checkLine(section.recommendedAnswer, `${path}.recommendedAnswer`, READABILITY_LIMITS.maxDecisionLineLength);
        const linked = optionSets.filter((set) => set.questionId === section.id);
        const options = linked.flatMap((set) => set.options);
        if (options.length < 2 || options.length > 4) refuse(path, "option_count", `Each question needs 2\u20134 short options; this question has ${options.length}.`);
        if (!options.some((option) => option.id === section.recommendedOptionId)) {
          refuse(`${path}.recommendedOptionId`, "unknown_recommended_option", "Identify the recommended option by its id among this question's options, with the reason in recommendedAnswer.");
        }
        const texts = [
          section.question,
          section.context,
          section.recommendedAnswer,
          section.answer,
          options.find((option) => option.id === section.recommendedOptionId)?.label,
          ...linked.map((set) => set.title),
          ...options.flatMap((o) => [o.label, o.consequence, o.body, o.annotationComment])
        ];
        checkCodes(section.question, `${path}.question`);
        checkCodes(section.context, `${path}.context`);
        checkCodes(section.recommendedAnswer, `${path}.recommendedAnswer`);
        checkCodes(section.answer, `${path}.answer`);
        const minutes = section.readingTimeMinutes;
        const minimum = minutesFor(texts);
        if (minutes === void 0) {
          refuse(`${path}.readingTimeMinutes`, "missing_reading_time", "Estimate the time to read this question, context and options in readingTimeMinutes (up to 2 minutes).");
        } else if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 2) {
          refuse(`${path}.readingTimeMinutes`, "reading_time_exceeded", "Each question must take a positive finite time of at most 2 minutes; shorten or split it.");
        } else {
          if (minutes < minimum) refuse(`${path}.readingTimeMinutes`, "reading_time_underestimated", `This question needs at least ${minimum.toFixed(2)} minutes at 180 words/minute; shorten it or correct its estimate (maximum 2 minutes).`);
          totalQuestionMinutes += Math.max(minutes, minimum);
        }
        break;
      }
    }
  });
  if (budgetValid && totalQuestionMinutes + minutesFor(shared) > budget) {
    refuse("$.readability.readingBudgetMinutes", "reading_budget_exceeded", "The questions plus shared context and glossary exceed the declared reading budget; shorten the dossier to match its stakes.");
  }
  return issues;
  function checkLine(text2, path, max) {
    if (!text2) return;
    if (text2.trim().length > max || LINE_BREAK.test(text2)) refuse(
      path,
      "decision_line_too_long",
      `Use one short line of at most ${max} characters; put explanation in the question context.`
    );
    if (SUBOPTION_PATTERN.test(text2)) refuse(
      path,
      "nested_suboptions",
      "Expose sub-choices as separate options or questions, without nested lists or inline branches."
    );
  }
  function checkOption(option, path) {
    const fields = [
      { field: "label", text: option.label, max: READABILITY_LIMITS.maxOptionLabelLength, code: "option_too_long" },
      { field: "consequence", text: option.consequence, max: READABILITY_LIMITS.maxConsequenceLength, code: "consequence_too_long" },
      { field: "body", text: option.body, max: READABILITY_LIMITS.maxOptionBodyLength, code: "option_too_long" },
      { field: "annotationComment", text: option.annotationComment, max: READABILITY_LIMITS.maxOptionBodyLength, code: "option_too_long" }
    ];
    if (blank(option.label)) refuse(`${path}.label`, "empty_option_label", "Name this option in a few plain words so the owner can compare it at a glance.");
    if (blank(option.consequence)) refuse(`${path}.consequence`, "missing_consequence", "Add a one-line consequence: what choosing this option changes for the owner.");
    for (const { field, text: text2, max, code } of fields) {
      if (!text2) continue;
      checkCodes(text2, `${path}.${field}`);
      if (text2.trim().length > max || LINE_BREAK.test(text2)) refuse(`${path}.${field}`, code, `Keep this option ${field} to one short line of at most ${max} characters; move necessary context to the question.`);
      if (SUBOPTION_PATTERN.test(text2) || CHOICE_PATTERN.test(text2)) refuse(`${path}.${field}`, "nested_suboptions", "This option hides sub-options: expose the choices as separate options or as a separate question.");
    }
  }
};

// packages/focus/src/validation/evidence-shape.ts
var EvidenceError = class extends Error {
  constructor(issue2) {
    super(issue2.message);
    this.issue = issue2;
  }
};
var fail = (path, code, message) => {
  throw new EvidenceError({ path, code, message });
};
function record(value, path, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "invalid_evidence", "Expected a closed object");
  const obj = value;
  for (const key of Object.keys(obj)) if (![...required, ...optional].includes(key)) fail(`${path}.${key}`, "invalid_evidence", "Unknown evidence field");
  for (const key of required) if (!Object.hasOwn(obj, key)) fail(`${path}.${key}`, "invalid_evidence", "Missing evidence field");
  return obj;
}
function text(value, path, allowEmpty = false) {
  if (typeof value !== "string" || !allowEmpty && !value.trim()) fail(path, "invalid_evidence", "Expected a non-empty string");
  return value;
}
function array(value, path) {
  if (!Array.isArray(value)) fail(path, "invalid_evidence", "Expected an array");
  return value;
}
var strings = (value, path) => array(value, path).map((v, i) => text(v, `${path}[${i}]`));
function imageDimensions(bytes, media) {
  const u32 = (n) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(n);
  if (media === "image/png") {
    if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) && u32(8) === 13 && u32(12) === 1229472850) return [u32(16), u32(20)];
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let i = 2;
    while (i + 4 < bytes.length && bytes[i] === 255) {
      const marker = bytes[i + 1], size = bytes[i + 2] << 8 | bytes[i + 3];
      if (size < 2 || i + 2 + size > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 8)
        return [bytes[i + 7] << 8 | bytes[i + 8], bytes[i + 5] << 8 | bytes[i + 6]];
      i += size + 2;
    }
  }
  return void 0;
}

// packages/focus/src/validation/evidence-bytes.ts
var K = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
var rr = (v, n) => v >>> n | v << 32 - n;
function sha256(bytes) {
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer), bits = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 4294967296));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
  const w = new Int32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = w[i - 16] + (rr(x, 7) ^ rr(x, 18) ^ x >>> 3) + w[i - 7] + (rr(y, 17) ^ rr(y, 19) ^ y >>> 10);
    }
    let [a, b, c, d, e, f, g, j] = h;
    for (let i = 0; i < 64; i++) {
      const t = j + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + (e & f ^ ~e & g) + K[i] + w[i] | 0;
      const u = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + (a & b ^ a & c ^ b & c) | 0;
      j = g;
      g = f;
      f = e;
      e = d + t | 0;
      d = c;
      c = b;
      b = a;
      a = t + u | 0;
    }
    [a, b, c, d, e, f, g, j].forEach((v, i) => {
      h[i] = h[i] + v | 0;
    });
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}
function decodeEvidence(data) {
  if (data.length % 4 || /[^A-Za-z0-9+/]/.test(data.replace(/={1,2}$/, ""))) throw new Error("Invalid base64");
  const binary = atob(data);
  if (btoa(binary) !== data) throw new Error("Non-canonical base64");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
var evidenceText = (bytes) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
var evidenceLines = (text2) => text2.split(/\r\n|\n|\r/);

// packages/focus/src/validation/evidence-sources.ts
var isTextSource = (media) => /^text\/[a-z0-9.+-]+$/.test(media) || ["application/json", "application/yaml", "application/x-yaml", "application/x-ndjson"].includes(media);
function checkSources(value, register) {
  const lineCounts = /* @__PURE__ */ new Map();
  const sources = array(value, "$.sources").map((raw, i) => {
    const path = `$.sources[${i}]`;
    const s = record(raw, path, ["id", "title", "origin", "mediaType", "encoding", "data", "sha256", "size"], ["width", "height", "alt"]);
    for (const key of ["id", "title", "mediaType", "sha256"]) text(s[key], `${path}.${key}`);
    register(s.id, `${path}.id`);
    const origin = s.origin;
    const fields = origin && Object.hasOwn(origin, "uri") ? ["uri"] : ["repo", "revision", "path"];
    record(origin, `${path}.origin`, fields);
    for (const key of fields) text(origin[key], `${path}.origin.${key}`);
    if (s.encoding !== "base64") fail(`${path}.encoding`, "source_encoding", "Only original base64 bytes are accepted");
    const media = s.mediaType;
    if (!isTextSource(media) && !["image/png", "image/jpeg"].includes(media)) fail(`${path}.mediaType`, "unsupported_media", `Unsupported media for source ${s.id}`);
    let bytes;
    try {
      bytes = decodeEvidence(text(s.data, `${path}.data`, true));
    } catch {
      return fail(`${path}.data`, "source_encoding", `Invalid base64 for source ${s.id}`);
    }
    if (!Number.isSafeInteger(s.size) || s.size !== bytes.length) fail(`${path}.size`, "source_size", `Byte size mismatch for source ${s.id}`);
    if (!/^[a-f0-9]{64}$/.test(s.sha256) || sha256(bytes) !== s.sha256) fail(`${path}.sha256`, "source_digest", `SHA-256 mismatch for source ${s.id}`);
    if (isTextSource(media)) {
      try {
        lineCounts.set(s.id, evidenceLines(evidenceText(bytes)).length);
      } catch {
        fail(`${path}.data`, "source_encoding", `Invalid UTF-8 for source ${s.id}`);
      }
      for (const key of ["width", "height", "alt"]) if (s[key] !== void 0) fail(`${path}.${key}`, "invalid_evidence", "Image metadata on text");
    } else {
      text(s.alt, `${path}.alt`);
      const dimensions = imageDimensions(bytes, media);
      if (!dimensions || !Number.isSafeInteger(s.width) || !Number.isSafeInteger(s.height) || dimensions[0] <= 0 || dimensions[1] <= 0 || dimensions[0] !== s.width || dimensions[1] !== s.height)
        fail(path, "image_metadata", `Image dimensions/signature mismatch for source ${s.id}`);
    }
    return s;
  });
  return { sources, lineCounts };
}

// packages/focus/src/validation/evidence.ts
function checkEvidence(value, legacy) {
  try {
    const { schemaVersion: _version, sources: rawSources, citations: rawCitations, evidenceGroups: rawGroups, annexes: rawAnnexes, ...base } = value;
    const citationLinks = /* @__PURE__ */ new Map();
    const strip = (raw, path) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const { citationRefs, ...node } = raw;
      if (citationRefs !== void 0) citationLinks.set(path, strings(citationRefs, `${path}.citationRefs`));
      return node;
    };
    if (Array.isArray(base.sections)) base.sections = base.sections.map((raw, i) => {
      const section = strip(raw, `$.sections[${i}]`);
      if (section?.kind === "optionSet" && Array.isArray(section.options)) return {
        ...section,
        options: section.options.map((o, j) => strip(o, `$.sections[${i}].options[${j}]`))
      };
      return section;
    });
    const checked = legacy(base);
    if (!checked.ok) return checked;
    const doc = checked.value, seen = /* @__PURE__ */ new Set(), targets = /* @__PURE__ */ new Set([doc.ref]);
    const register = (id, path) => {
      if (seen.has(id)) fail(path, "duplicate_id", `Duplicate id ${id}`);
      seen.add(id);
    };
    doc.sections.forEach((s) => {
      register(s.id, "$.sections");
      targets.add(s.id);
      targets.add(s.targetRef);
      if (s.kind === "optionSet") s.options.forEach((o) => {
        register(o.id, "$.sections.options");
        targets.add(o.id);
        targets.add(o.targetRef);
      });
    });
    const { sources, lineCounts } = checkSources(rawSources, register);
    const sourceMap = new Map(sources.map((s) => [s.id, s]));
    const citations = array(rawCitations, "$.citations").map((raw, i) => {
      const p = `$.citations[${i}]`, c = record(raw, p, ["id", "sourceId", "label", "locator"]);
      for (const key of ["id", "sourceId", "label"]) text(c[key], `${p}.${key}`);
      register(c.id, `${p}.id`);
      const source = sourceMap.get(c.sourceId) ?? fail(`${p}.sourceId`, "unresolved_source", `Unknown source ${c.sourceId}`);
      const loc = c.locator;
      if (loc?.kind === "lines") {
        record(loc, `${p}.locator`, ["kind", "start", "end"]);
        if (!lineCounts.has(source.id)) fail(`${p}.locator`, "citation_media", `Source ${source.id} is not text`);
        if (!Number.isSafeInteger(loc.start) || !Number.isSafeInteger(loc.end) || loc.start < 1 || loc.end < loc.start || loc.end > lineCounts.get(source.id))
          fail(`${p}.locator`, "citation_range", `Invalid inclusive line range for ${source.id}`);
      } else if (loc?.kind === "image") {
        record(loc, `${p}.locator`, ["kind", "caption"]);
        text(loc.caption, `${p}.locator.caption`);
        if (!source.mediaType.startsWith("image/")) fail(`${p}.locator`, "citation_media", `Source ${source.id} is not an image`);
      } else fail(`${p}.locator`, "invalid_evidence", "Unknown citation locator");
      return c;
    });
    const citationIds = new Set(citations.map((c) => c.id));
    const references = (raw, p, ids, code) => {
      const refs = strings(raw, p);
      for (const id of refs) if (!ids.has(id)) fail(p, code, `Unresolved reference ${id}`);
      return refs;
    };
    for (const [path, refs] of citationLinks) references(refs, `${path}.citationRefs`, citationIds, "unresolved_citation");
    const evidenceGroups = array(rawGroups, "$.evidenceGroups").map((raw, i) => {
      const p = `$.evidenceGroups[${i}]`, g = record(raw, p, ["id", "summary", "citationRefs", "sourceRefs"]);
      register(text(g.id, `${p}.id`), `${p}.id`);
      text(g.summary, `${p}.summary`);
      references(g.citationRefs, `${p}.citationRefs`, citationIds, "unresolved_citation");
      references(g.sourceRefs, `${p}.sourceRefs`, new Set(sourceMap.keys()), "unresolved_source");
      return g;
    });
    const annexes = array(rawAnnexes, "$.annexes").map((raw, i) => {
      const p = `$.annexes[${i}]`, a = record(raw, p, ["id", "title", "summary", "blocks", "backRefs"]);
      register(text(a.id, `${p}.id`), `${p}.id`);
      text(a.title, `${p}.title`);
      text(a.summary, `${p}.summary`);
      references(a.backRefs, `${p}.backRefs`, targets, "unresolved_target");
      array(a.blocks, `${p}.blocks`).forEach((rawBlock, j) => {
        const bpath = `${p}.blocks[${j}]`, kind = rawBlock?.kind;
        if (kind === "text" || kind === "code") {
          const b = record(rawBlock, bpath, ["kind", "text"], kind === "code" ? ["language"] : []);
          text(b.text, `${bpath}.text`, true);
          if (b.language !== void 0) text(b.language, `${bpath}.language`);
        } else if (kind === "table") {
          const b = record(rawBlock, bpath, ["kind", "columns", "rows"]);
          const columns = strings(b.columns, `${bpath}.columns`);
          if (!columns.length) fail(bpath, "invalid_evidence", "A table needs columns");
          array(b.rows, `${bpath}.rows`).forEach((row, k) => {
            const cells = array(row, `${bpath}.rows[${k}]`);
            cells.forEach((cell, l) => text(cell, `${bpath}.rows[${k}][${l}]`, true));
            if (cells.length !== columns.length) fail(bpath, "invalid_evidence", "Table row width mismatch");
          });
        } else if (kind === "references") {
          const b = record(rawBlock, bpath, ["kind", "citationRefs"]);
          references(b.citationRefs, `${bpath}.citationRefs`, citationIds, "unresolved_citation");
        } else fail(`${bpath}.kind`, "invalid_evidence", "Unsupported annex block (no decisions or active content)");
      });
      return a;
    });
    const attach = (node, path) => citationLinks.has(path) ? { ...node, citationRefs: citationLinks.get(path) } : node;
    const sections = doc.sections.map((s, i) => attach(s.kind === "optionSet" ? {
      ...s,
      options: s.options.map((o, j) => attach(o, `$.sections[${i}].options[${j}]`))
    } : s, `$.sections[${i}]`));
    return { ok: true, value: { ...doc, schemaVersion: 2, sections, sources, citations, evidenceGroups, annexes } };
  } catch (error) {
    if (error instanceof EvidenceError) return { ok: false, issues: [error.issue] };
    throw error;
  }
}

// packages/focus/src/validation/index.ts
var DOSSIER_SCHEMA_ID = "urn:sentropic:focus:DecisionDossierDocument:1.0.0";
var DOSSIER_SCHEMA_VERSION = "1.0.0";
var DecisionDossierValidationError = class extends Error {
  issues;
  constructor(issues) {
    super(
      `invalid DecisionDossierDocument: ${issues.map((issue2) => `${issue2.path} ${issue2.code}: ${issue2.message}`).join("; ")}`
    );
    this.name = "DecisionDossierValidationError";
    this.issues = issues;
  }
};
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var issue = (path, code, message) => ({
  path,
  code,
  message
});
var checkClosedObject = (value, path, allowed, required, stringKeys, issues) => {
  if (!isRecord(value)) {
    issues.push(issue(path, "invalid_type", "expected an object"));
    return void 0;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issues.push(issue(`${path}.${key}`, "unknown_field", "field not in the closed schema"));
    }
  }
  for (const key of required) {
    if (value[key] === void 0) {
      issues.push(issue(`${path}.${key}`, "missing_field", "required field is missing"));
    }
  }
  for (const key of stringKeys) {
    if (value[key] !== void 0 && typeof value[key] !== "string") {
      issues.push(issue(`${path}.${key}`, "invalid_type", "expected a string"));
    }
  }
  return value;
};
var checkEnum = (value, path, allowed, issues) => {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(
      issue(path, "invalid_enum", `expected one of: ${allowed.join(" | ")}`)
    );
  }
};
var TOP_REQUIRED = [
  "ref",
  "subject",
  "title",
  "hash",
  "cursor",
  "sections",
  "interactions",
  "provenance",
  "amendmentTrace"
];
var TOP_STRINGS = ["ref", "subject", "title", "hash", "cursor"];
var TOP_ALLOWED = [...TOP_REQUIRED, "readability"];
var checkOptionNode = (value, path, issues) => {
  const start = issues.length;
  const node = checkClosedObject(
    value,
    path,
    ["kind", "id", "targetRef", "label", "body", "annotation", "annotationComment", "consequence"],
    ["kind", "id", "targetRef", "label", "annotation"],
    ["id", "targetRef", "label", "body", "annotationComment", "consequence"],
    issues
  );
  if (node === void 0) return void 0;
  if (node["kind"] !== "option") {
    issues.push(issue(`${path}.kind`, "invalid_discriminator", 'expected "option"'));
  }
  checkEnum(node["annotation"], `${path}.annotation`, ["none", "accept", "reject", "comment"], issues);
  if (issues.length !== start) return void 0;
  return {
    kind: "option",
    id: node["id"],
    targetRef: node["targetRef"],
    label: node["label"],
    ...typeof node["body"] === "string" ? { body: node["body"] } : {},
    annotation: node["annotation"],
    ...typeof node["annotationComment"] === "string" ? { annotationComment: node["annotationComment"] } : {},
    ...typeof node["consequence"] === "string" ? { consequence: node["consequence"] } : {}
  };
};
var checkAmendmentStep = (value, path, issues) => {
  const start = issues.length;
  const step = checkClosedObject(
    value,
    path,
    ["at", "author", "summary"],
    ["at", "author", "summary"],
    ["at", "author", "summary"],
    issues
  );
  if (step === void 0 || issues.length !== start) return void 0;
  return { at: step["at"], author: step["author"], summary: step["summary"] };
};
var checkSectionNode = (value, path, issues) => {
  if (!isRecord(value)) {
    issues.push(issue(path, "invalid_type", "expected an object"));
    return void 0;
  }
  const kind = value["kind"];
  if (kind !== "prose" && kind !== "question" && kind !== "optionSet" && kind !== "outcome" && kind !== "amendmentTrace" && kind !== "diagram") {
    issues.push(
      issue(
        `${path}.kind`,
        typeof kind === "undefined" ? "missing_field" : "unknown_node_kind",
        `unknown section kind ${typeof kind === "string" ? `"${kind}"` : " discriminant"}`
      )
    );
    return void 0;
  }
  const start = issues.length;
  switch (kind) {
    case "prose": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "markdown", "questionId"],
        ["kind", "id", "targetRef", "markdown"],
        ["id", "targetRef", "markdown", "questionId"],
        issues
      );
      if (node === void 0 || issues.length !== start) return void 0;
      return { kind: "prose", id: node["id"], targetRef: node["targetRef"], markdown: node["markdown"], ...typeof node["questionId"] === "string" ? { questionId: node["questionId"] } : {} };
    }
    case "question": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "question", "recommendedAnswer", "answer", "state", "context", "readingTimeMinutes", "recommendedOptionId"],
        ["kind", "id", "targetRef", "question", "state"],
        ["id", "targetRef", "question", "recommendedAnswer", "answer", "context", "recommendedOptionId"],
        issues
      );
      if (node === void 0) return void 0;
      checkEnum(node["state"], `${path}.state`, ["open", "answered", "validated"], issues);
      if (node["readingTimeMinutes"] !== void 0 && (typeof node["readingTimeMinutes"] !== "number" || !Number.isFinite(node["readingTimeMinutes"]))) {
        issues.push(issue(`${path}.readingTimeMinutes`, "invalid_type", "expected a finite number"));
      }
      if (issues.length !== start) return void 0;
      return {
        kind: "question",
        id: node["id"],
        targetRef: node["targetRef"],
        question: node["question"],
        ...typeof node["recommendedAnswer"] === "string" ? { recommendedAnswer: node["recommendedAnswer"] } : {},
        ...typeof node["answer"] === "string" ? { answer: node["answer"] } : {},
        state: node["state"],
        ...typeof node["context"] === "string" ? { context: node["context"] } : {},
        ...typeof node["recommendedOptionId"] === "string" ? { recommendedOptionId: node["recommendedOptionId"] } : {},
        ...typeof node["readingTimeMinutes"] === "number" ? { readingTimeMinutes: node["readingTimeMinutes"] } : {}
      };
    }
    case "optionSet": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "title", "options", "questionId"],
        ["kind", "id", "targetRef", "options"],
        ["id", "targetRef", "title", "questionId"],
        issues
      );
      if (node === void 0) return void 0;
      const options = [];
      if (!Array.isArray(node["options"])) {
        issues.push(issue(`${path}.options`, "invalid_type", "expected an array"));
      } else {
        node["options"].forEach((option, index) => {
          const checked = checkOptionNode(option, `${path}.options[${index}]`, issues);
          if (checked !== void 0) options.push(checked);
        });
      }
      if (issues.length !== start) return void 0;
      return {
        kind: "optionSet",
        id: node["id"],
        targetRef: node["targetRef"],
        ...typeof node["title"] === "string" ? { title: node["title"] } : {},
        options,
        ...typeof node["questionId"] === "string" ? { questionId: node["questionId"] } : {}
      };
    }
    case "outcome": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "modality", "statement", "questionId"],
        ["kind", "id", "targetRef", "modality", "statement"],
        ["id", "targetRef", "statement", "questionId"],
        issues
      );
      if (node === void 0) return void 0;
      checkEnum(node["modality"], `${path}.modality`, ["decision", "orientation", "amendment", "comment"], issues);
      if (issues.length !== start) return void 0;
      return {
        kind: "outcome",
        id: node["id"],
        targetRef: node["targetRef"],
        modality: node["modality"],
        statement: node["statement"],
        ...typeof node["questionId"] === "string" ? { questionId: node["questionId"] } : {}
      };
    }
    case "amendmentTrace": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "steps"],
        ["kind", "id", "targetRef", "steps"],
        ["id", "targetRef"],
        issues
      );
      if (node === void 0) return void 0;
      const steps = [];
      if (!Array.isArray(node["steps"])) {
        issues.push(issue(`${path}.steps`, "invalid_type", "expected an array"));
      } else {
        node["steps"].forEach((step, index) => {
          const checked = checkAmendmentStep(step, `${path}.steps[${index}]`, issues);
          if (checked !== void 0) steps.push(checked);
        });
      }
      if (issues.length !== start) return void 0;
      return {
        kind: "amendmentTrace",
        id: node["id"],
        targetRef: node["targetRef"],
        steps
      };
    }
    case "diagram": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "syntax", "source", "alt", "scene"],
        ["kind", "id", "targetRef", "syntax", "source", "alt"],
        ["id", "targetRef", "source", "alt"],
        issues
      );
      if (node === void 0) return void 0;
      checkEnum(node["syntax"], `${path}.syntax`, ["mermaid", "plantuml"], issues);
      if (node["scene"] !== void 0 && !isRecord(node["scene"])) {
        issues.push(issue(`${path}.scene`, "invalid_type", "expected a diagram-core SemanticDocument object"));
      }
      if (issues.length !== start) return void 0;
      return {
        kind: "diagram",
        id: node["id"],
        targetRef: node["targetRef"],
        syntax: node["syntax"],
        source: node["source"],
        alt: node["alt"],
        ...node["scene"] === void 0 ? {} : { scene: node["scene"] }
      };
    }
  }
};
var checkInteraction = (value, path, issues) => {
  const start = issues.length;
  const affordance = checkClosedObject(
    value,
    path,
    ["name", "targetRef", "label", "enabled"],
    ["name", "targetRef", "label", "enabled"],
    ["name", "targetRef", "label"],
    issues
  );
  if (affordance === void 0) return void 0;
  if (affordance["enabled"] !== false) {
    issues.push(
      issue(`${path}.enabled`, "enabled_action", "snapshot interactions must stay disabled (enabled:false)")
    );
  }
  if (issues.length !== start) return void 0;
  return {
    name: affordance["name"],
    targetRef: affordance["targetRef"],
    label: affordance["label"],
    enabled: false
  };
};
var checkGlossaryEntry = (value, path, issues) => {
  const start = issues.length;
  const entry = checkClosedObject(
    value,
    path,
    ["term", "definition"],
    ["term", "definition"],
    ["term", "definition"],
    issues
  );
  if (entry === void 0 || issues.length !== start) return void 0;
  return { term: entry["term"], definition: entry["definition"] };
};
var checkReadability = (value, path, issues) => {
  const start = issues.length;
  const block = checkClosedObject(
    value,
    path,
    ["ownerRequestQuote", "noOwnerRequest", "stakes", "stakesLevel", "readingBudgetMinutes", "glossary"],
    [],
    ["ownerRequestQuote", "stakes"],
    issues
  );
  if (block === void 0) return void 0;
  if (block["stakesLevel"] !== void 0) {
    checkEnum(block["stakesLevel"], `${path}.stakesLevel`, ["low", "medium", "high"], issues);
  }
  if (block["noOwnerRequest"] !== void 0 && typeof block["noOwnerRequest"] !== "boolean") {
    issues.push(issue(`${path}.noOwnerRequest`, "invalid_type", "expected a boolean"));
  }
  if (block["readingBudgetMinutes"] !== void 0 && (typeof block["readingBudgetMinutes"] !== "number" || !Number.isFinite(block["readingBudgetMinutes"]))) {
    issues.push(issue(`${path}.readingBudgetMinutes`, "invalid_type", "expected a finite number"));
  }
  let glossary;
  if (block["glossary"] !== void 0) {
    glossary = [];
    if (!Array.isArray(block["glossary"])) {
      issues.push(issue(`${path}.glossary`, "invalid_type", "expected an array"));
    } else {
      block["glossary"].forEach((entry, index) => {
        const checked = checkGlossaryEntry(entry, `${path}.glossary[${index}]`, issues);
        if (checked !== void 0) glossary.push(checked);
      });
    }
  }
  if (issues.length !== start) return void 0;
  return {
    ...typeof block["ownerRequestQuote"] === "string" ? { ownerRequestQuote: block["ownerRequestQuote"] } : {},
    ...typeof block["noOwnerRequest"] === "boolean" ? { noOwnerRequest: block["noOwnerRequest"] } : {},
    ...typeof block["stakes"] === "string" ? { stakes: block["stakes"] } : {},
    ...block["stakesLevel"] !== void 0 ? { stakesLevel: block["stakesLevel"] } : {},
    ...typeof block["readingBudgetMinutes"] === "number" ? { readingBudgetMinutes: block["readingBudgetMinutes"] } : {},
    ...glossary !== void 0 ? { glossary } : {}
  };
};
var validateLegacyStructure = (value) => {
  const issues = [];
  const doc = checkClosedObject(value, "$", [...TOP_ALLOWED], [...TOP_REQUIRED], [...TOP_STRINGS], issues);
  if (doc === void 0) return { ok: false, issues };
  const sections = [];
  if (!Array.isArray(doc["sections"])) {
    issues.push(issue("$.sections", "invalid_type", "expected an array"));
  } else {
    doc["sections"].forEach((section, index) => {
      const checked = checkSectionNode(section, `$.sections[${index}]`, issues);
      if (checked !== void 0) sections.push(checked);
    });
  }
  const interactions = [];
  if (!Array.isArray(doc["interactions"])) {
    issues.push(issue("$.interactions", "invalid_type", "expected an array"));
  } else {
    doc["interactions"].forEach((interaction, index) => {
      const checked = checkInteraction(interaction, `$.interactions[${index}]`, issues);
      if (checked !== void 0) interactions.push(checked);
    });
  }
  let provenance;
  const rawProvenance = checkClosedObject(
    doc["provenance"],
    "$.provenance",
    ["source", "readAt", "comprehensionEvidence"],
    ["source", "readAt"],
    ["source", "readAt"],
    issues
  );
  if (rawProvenance !== void 0) {
    let evidence;
    if (rawProvenance["comprehensionEvidence"] !== void 0) {
      const evidenceStart = issues.length;
      const rawEvidence = checkClosedObject(
        rawProvenance["comprehensionEvidence"],
        "$.provenance.comprehensionEvidence",
        ["subject", "dossierHash", "signature"],
        ["subject", "dossierHash"],
        ["subject", "dossierHash", "signature"],
        issues
      );
      if (rawEvidence !== void 0 && issues.length === evidenceStart) {
        evidence = {
          subject: rawEvidence["subject"],
          dossierHash: rawEvidence["dossierHash"],
          ...typeof rawEvidence["signature"] === "string" ? { signature: rawEvidence["signature"] } : {}
        };
      }
    }
    provenance = {
      source: rawProvenance["source"],
      readAt: rawProvenance["readAt"],
      ...evidence !== void 0 ? { comprehensionEvidence: evidence } : {}
    };
  }
  const amendmentTrace = [];
  if (!Array.isArray(doc["amendmentTrace"])) {
    issues.push(issue("$.amendmentTrace", "invalid_type", "expected an array"));
  } else {
    doc["amendmentTrace"].forEach((step, index) => {
      const checked = checkAmendmentStep(step, `$.amendmentTrace[${index}]`, issues);
      if (checked !== void 0) amendmentTrace.push(checked);
    });
  }
  let readability;
  if (doc["readability"] !== void 0) {
    readability = checkReadability(doc["readability"], "$.readability", issues);
  }
  if (issues.length > 0 || provenance === void 0 || doc["readability"] !== void 0 && readability === void 0) {
    return { ok: false, issues };
  }
  if (typeof doc["ref"] !== "string" || typeof doc["subject"] !== "string" || typeof doc["title"] !== "string" || typeof doc["hash"] !== "string" || typeof doc["cursor"] !== "string") {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      ref: doc["ref"],
      subject: doc["subject"],
      title: doc["title"],
      hash: doc["hash"],
      cursor: doc["cursor"],
      sections,
      interactions,
      provenance,
      amendmentTrace,
      ...readability !== void 0 ? { readability } : {}
    }
  };
};
var validateDecisionDossierStructure = (value) => {
  if (isRecord(value) && Object.hasOwn(value, "schemaVersion")) {
    if (value.schemaVersion !== 2) return { ok: false, issues: [issue("$.schemaVersion", "unsupported_version", "Supported explicit version: 2; omit schemaVersion for legacy v1")] };
    return checkEvidence(value, validateLegacyStructure);
  }
  return validateLegacyStructure(value);
};
var validateDecisionDossierSemantics = (doc) => {
  const issues = [];
  const seen = /* @__PURE__ */ new Map();
  const registerId = (id, path) => {
    const first = seen.get(id);
    if (first !== void 0) {
      issues.push(issue(path, "duplicate_id", `node id "${id}" already used at ${first}`));
    } else {
      seen.set(id, path);
    }
  };
  doc.sections.forEach((section, index) => {
    const path = `$.sections[${index}]`;
    registerId(section.id, `${path}.id`);
    if (section.kind === "optionSet") {
      section.options.forEach((option, optionIndex) => {
        registerId(option.id, `${path}.options[${optionIndex}].id`);
      });
    }
  });
  const resolvable = /* @__PURE__ */ new Set([doc.ref]);
  for (const section of doc.sections) {
    resolvable.add(section.id);
    resolvable.add(section.targetRef);
    if (section.kind === "optionSet") {
      for (const option of section.options) {
        resolvable.add(option.id);
        resolvable.add(option.targetRef);
      }
    }
  }
  doc.interactions.forEach((interaction, index) => {
    if (!resolvable.has(interaction.targetRef)) {
      issues.push(
        issue(
          `$.interactions[${index}].targetRef`,
          "unresolved_target",
          `interaction target "${interaction.targetRef}" resolves to no node`
        )
      );
    }
  });
  const evidence = doc.provenance.comprehensionEvidence;
  if (evidence !== void 0 && evidence.dossierHash !== doc.hash) {
    issues.push(
      issue(
        "$.provenance.comprehensionEvidence.dossierHash",
        "evidence_mismatch",
        "comprehension evidence does not match the snapshot hash"
      )
    );
  }
  return issues;
};
var validateDecisionDossierDocument = (value) => {
  const structural = validateDecisionDossierStructure(value);
  if (!structural.ok) return structural;
  const semantic = validateDecisionDossierSemantics(structural.value);
  if (semantic.length > 0) return { ok: false, issues: semantic };
  return structural;
};
var assertDecisionDossierDocument = (value) => {
  const result = validateDecisionDossierDocument(value);
  if (!result.ok) throw new DecisionDossierValidationError(result.issues);
  return result.value;
};
var validateDecisionDossierForPresentation = (value) => {
  const result = validateDecisionDossierDocument(value);
  if (!result.ok) return result;
  const issues = validateDecisionDossierReadability(result.value);
  return issues.length > 0 ? { ok: false, issues } : result;
};
var assertDecisionDossierForPresentation = (value) => {
  const result = validateDecisionDossierForPresentation(value);
  if (!result.ok) throw new DecisionDossierValidationError(result.issues);
  return result.value;
};
export {
  DOSSIER_SCHEMA_ID,
  DOSSIER_SCHEMA_VERSION,
  DecisionDossierValidationError,
  READABILITY_BUDGETS,
  READABILITY_LIMITS,
  assertDecisionDossierDocument,
  assertDecisionDossierForPresentation,
  validateDecisionDossierDocument,
  validateDecisionDossierForPresentation,
  validateDecisionDossierReadability,
  validateDecisionDossierSemantics,
  validateDecisionDossierStructure
};
