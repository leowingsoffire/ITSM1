/**
 * Document classification.
 *
 * Scores every candidate type against OCR output using weighted evidence:
 *  - title / heading matches      (strongest signal)
 *  - keyword occurrences in body
 *  - key-value label matches
 *  - page-count plausibility
 *
 * Deliberately implemented as an explainable rules engine: reviewers can see
 * exactly which evidence drove the routing decision, which is a hard requirement
 * for finance and regulatory processes.
 */
import { listClassifiableTypes } from '../domain/documentTypes.js';

const WEIGHT = Object.freeze({
  TITLE_MATCH: 6,
  HEADING_MATCH: 2.5,
  KEYWORD_MATCH: 1.6,
  FIELD_LABEL_MATCH: 1.1,
  PAGE_RANGE_MATCH: 1.5
});

const MAX_BODY_SAMPLE_CHARACTERS = 60000;
const MIN_ACCEPT_SCORE = 4;

const normalise = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @param {object} analysis Normalised analysis result.
 * @returns {{typeId: string, confidence: number, evidence: string[], alternatives: Array}}
 */
export function classifyDocument(analysis) {
  const titles = (analysis.paragraphs ?? [])
    .filter((paragraph) => paragraph.role === 'title')
    .map((paragraph) => normalise(paragraph.content));
  const headings = (analysis.paragraphs ?? [])
    .filter((paragraph) => paragraph.role === 'sectionHeading')
    .map((paragraph) => normalise(paragraph.content));

  const body = normalise(analysis.fullText).slice(0, MAX_BODY_SAMPLE_CHARACTERS);
  const kvLabels = (analysis.keyValuePairs ?? []).map((pair) => normalise(pair.key));
  const pageCount = analysis.pageCount ?? 1;

  const scored = listClassifiableTypes().map((type) => {
    const evidence = [];
    let score = 0;

    const typeName = normalise(type.name);
    if (titles.some((title) => title.includes(typeName) || typeName.includes(title))) {
      score += WEIGHT.TITLE_MATCH;
      evidence.push(`Document title matches "${type.name}"`);
    }

    for (const keyword of type.keywords) {
      const needle = normalise(keyword);
      if (!needle) continue;
      if (titles.some((title) => title.includes(needle))) {
        score += WEIGHT.TITLE_MATCH;
        evidence.push(`Title contains "${keyword}"`);
        continue;
      }
      if (headings.some((headingText) => headingText.includes(needle))) {
        score += WEIGHT.HEADING_MATCH;
        evidence.push(`Heading contains "${keyword}"`);
        continue;
      }
      if (body.includes(needle)) {
        score += WEIGHT.KEYWORD_MATCH;
        evidence.push(`Body contains "${keyword}"`);
      }
    }

    for (const field of type.fields) {
      const matched = field.aliases.some((alias) => kvLabels.includes(normalise(alias)));
      if (matched) {
        score += WEIGHT.FIELD_LABEL_MATCH;
        evidence.push(`Detected labelled field "${field.label}"`);
      }
    }

    const [minPages, maxPages] = type.typicalPages;
    if (pageCount >= minPages && pageCount <= maxPages) {
      score += WEIGHT.PAGE_RANGE_MATCH;
      evidence.push(`Page count ${pageCount} falls in the expected ${minPages}-${maxPages} range`);
    }

    return { typeId: type.id, name: type.name, score: Number(score.toFixed(2)), evidence };
  });

  scored.sort((left, right) => right.score - left.score);
  const best = scored[0];
  const runnerUp = scored[1];

  if (!best || best.score < MIN_ACCEPT_SCORE) {
    return {
      typeId: 'unclassified',
      confidence: 0,
      evidence: ['No document type reached the minimum classification score.'],
      alternatives: scored.slice(0, 3).map(({ typeId, name, score }) => ({ typeId, name, score }))
    };
  }

  // Confidence blends absolute score strength with the margin over the runner-up.
  const margin = best.score - (runnerUp?.score ?? 0);
  const strength = Math.min(1, best.score / 18);
  const separation = Math.min(1, margin / 8);
  const confidence = Number(Math.min(0.995, 0.55 + strength * 0.28 + separation * 0.17).toFixed(4));

  return {
    typeId: best.typeId,
    confidence,
    evidence: best.evidence.slice(0, 8),
    alternatives: scored.slice(1, 4).map(({ typeId, name, score }) => ({ typeId, name, score }))
  };
}
