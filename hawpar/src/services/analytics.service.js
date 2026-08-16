/**
 * Operational analytics.
 *
 * Aggregates the processed corpus into the KPIs Haw Par's process owners care
 * about: straight-through-processing rate, exception drivers, throughput,
 * extraction quality and realised cost/benefit.
 */
import { COST_CONSTANTS } from './cost.service.js';
import { DocumentStatus, listAllDocuments } from './store.service.js';

const TERMINAL_STATUSES = new Set([
  DocumentStatus.COMPLETED,
  DocumentStatus.NEEDS_REVIEW,
  DocumentStatus.APPROVED,
  DocumentStatus.REJECTED
]);

const PERCENT_PRECISION = 1;

const percent = (numerator, denominator) =>
  denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(PERCENT_PRECISION)) : 0;

function groupCount(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key === null || key === undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count);
}

export function buildDashboard() {
  const all = listAllDocuments();
  const processed = all.filter((record) => TERMINAL_STATUSES.has(record.status));
  const failed = all.filter((record) => record.status === DocumentStatus.FAILED);
  const inFlight = all.filter(
    (record) => record.status === DocumentStatus.QUEUED || record.status === DocumentStatus.PROCESSING
  );

  const totalPages = processed.reduce((sum, record) => sum + (record.pageCount ?? 0), 0);
  const straightThrough = processed.filter(
    (record) => record.status === DocumentStatus.COMPLETED || record.status === DocumentStatus.APPROVED
  );

  const fieldStats = processed.reduce(
    (accumulator, record) => {
      for (const field of record.fields) {
        accumulator.total += 1;
        if (field.status === 'accepted') accumulator.accepted += 1;
        if (field.confidence > 0) {
          accumulator.confidenceSum += field.confidence;
          accumulator.confidenceCount += 1;
        }
      }
      return accumulator;
    },
    { total: 0, accepted: 0, confidenceSum: 0, confidenceCount: 0 }
  );

  const ocrConfidences = processed
    .map((record) => record.quality?.averageOcrConfidence)
    .filter((value) => typeof value === 'number');

  const durations = processed
    .map((record) => record.durationMs)
    .filter((value) => typeof value === 'number' && value > 0)
    .sort((left, right) => left - right);

  const issueCounts = new Map();
  for (const record of processed) {
    for (const issue of record.validation?.issues ?? []) {
      const existing = issueCounts.get(issue.rule) ?? {
        rule: issue.rule,
        description: issue.description,
        severity: issue.severity,
        count: 0
      };
      existing.count += 1;
      issueCounts.set(issue.rule, existing);
    }
  }

  const azureCostUsd = processed.reduce((sum, record) => sum + (record.cost?.estimatedUsd ?? 0), 0);
  const modelledCostUsd = processed.reduce((sum, record) => sum + (record.cost?.modelledUsd ?? record.cost?.estimatedUsd ?? 0), 0);
  const baselineCostUsd = processed.reduce((sum, record) => sum + (record.cost?.baselineUsd ?? 0), 0);
  const manualCostSgd = processed.reduce((sum, record) => sum + (record.cost?.manualCostSgd ?? 0), 0);
  const manualMinutes = processed.reduce((sum, record) => sum + (record.cost?.manualEffortMinutes ?? 0), 0);
  const automatedMinutes = durations.reduce((sum, value) => sum + value / 60000, 0);

  return {
    generatedAt: new Date().toISOString(),
    volume: {
      totalDocuments: all.length,
      processed: processed.length,
      inFlight: inFlight.length,
      failed: failed.length,
      needsReview: processed.filter((record) => record.status === DocumentStatus.NEEDS_REVIEW).length,
      approved: processed.filter((record) => record.status === DocumentStatus.APPROVED).length,
      rejected: processed.filter((record) => record.status === DocumentStatus.REJECTED).length,
      totalPages,
      averagePages: processed.length > 0 ? Number((totalPages / processed.length).toFixed(1)) : 0,
      largestDocumentPages: processed.reduce((max, record) => Math.max(max, record.pageCount ?? 0), 0)
    },
    quality: {
      straightThroughRate: percent(straightThrough.length, processed.length),
      fieldAcceptanceRate: percent(fieldStats.accepted, fieldStats.total),
      averageFieldConfidence:
        fieldStats.confidenceCount > 0
          ? Number((fieldStats.confidenceSum / fieldStats.confidenceCount).toFixed(4))
          : 0,
      averageOcrConfidence:
        ocrConfidences.length > 0
          ? Number((ocrConfidences.reduce((sum, value) => sum + value, 0) / ocrConfidences.length).toFixed(4))
          : 0,
      documentsWithDegradedScans: processed.filter((record) => (record.quality?.degradedPages ?? []).length > 0).length,
      totalFields: fieldStats.total
    },
    performance: {
      averageSeconds: durations.length > 0 ? Number((durations.reduce((sum, value) => sum + value, 0) / durations.length / 1000).toFixed(2)) : 0,
      medianSeconds: durations.length > 0 ? Number((durations[Math.floor(durations.length / 2)] / 1000).toFixed(2)) : 0,
      p95Seconds: durations.length > 0 ? Number((durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] / 1000).toFixed(2)) : 0,
      pagesPerSecond:
        automatedMinutes > 0 ? Number((totalPages / (automatedMinutes * 60)).toFixed(2)) : 0
    },
    economics: {
      azureCostUsd: Number(azureCostUsd.toFixed(4)),
      modelledCostUsd: Number(modelledCostUsd.toFixed(4)),
      billedToAzure: azureCostUsd > 0,
      baselineCostUsd: Number(baselineCostUsd.toFixed(4)),
      routingSavingUsd: Number((baselineCostUsd - modelledCostUsd).toFixed(4)),
      manualBaselineSgd: Number(manualCostSgd.toFixed(2)),
      netBenefitSgd: Number((manualCostSgd - modelledCostUsd * COST_CONSTANTS.SGD_PER_USD).toFixed(2)),
      manualHoursAvoided: Number((manualMinutes / 60).toFixed(1)),
      automatedHours: Number((automatedMinutes / 60).toFixed(3))
    },
    mix: {
      byDocumentType: groupCount(processed, (record) => record.classification?.typeName ?? 'Unclassified'),
      byBusinessUnit: groupCount(processed, (record) => record.classification?.businessUnit ?? 'Unassigned'),
      byStatus: groupCount(all, (record) => record.status),
      byEngine: groupCount(processed, (record) => (record.engine === 'azure' ? 'Azure Document Intelligence' : 'Offline demo engine'))
    },
    topIssues: [...issueCounts.values()].sort((left, right) => right.count - left.count).slice(0, 8),
    throughput: buildThroughputSeries(processed)
  };
}

/** Documents completed per 5-minute bucket over the last hour. */
function buildThroughputSeries(processed) {
  const bucketMinutes = 5;
  const bucketCount = 12;
  const now = Date.now();
  const buckets = Array.from({ length: bucketCount }, (unused, index) => ({
    label: `-${(bucketCount - index) * bucketMinutes}m`,
    documents: 0,
    pages: 0
  }));

  for (const record of processed) {
    if (!record.completedAt) continue;
    const ageMinutes = (now - new Date(record.completedAt).getTime()) / 60000;
    if (ageMinutes < 0 || ageMinutes > bucketCount * bucketMinutes) continue;
    const index = bucketCount - 1 - Math.floor(ageMinutes / bucketMinutes);
    if (index < 0 || index >= bucketCount) continue;
    buckets[index].documents += 1;
    buckets[index].pages += record.pageCount ?? 0;
  }

  return buckets;
}

/** Documents awaiting a human decision, highest business impact first. */
export function buildReviewQueue({ limit = 50 } = {}) {
  const items = listAllDocuments()
    .filter((record) => record.status === DocumentStatus.NEEDS_REVIEW)
    .map((record) => {
      const failingFields = record.fields.filter((field) => field.status !== 'accepted');
      const criticalFailing = failingFields.filter((field) => field.critical).length;
      const priorityScore =
        (record.validation?.errorCount ?? 0) * 10 + criticalFailing * 6 + failingFields.length * 1.5;
      return {
        documentId: record.id,
        fileName: record.fileName,
        typeName: record.classification?.typeName ?? 'Unclassified',
        businessUnit: record.classification?.businessUnit ?? 'Unassigned',
        process: record.classification?.process ?? null,
        pageCount: record.pageCount,
        uploadedAt: record.uploadedAt,
        validationErrors: record.validation?.errorCount ?? 0,
        validationWarnings: record.validation?.warningCount ?? 0,
        fieldsToReview: failingFields.length,
        criticalFieldsToReview: criticalFailing,
        classificationConfidence: record.classification?.confidence ?? 0,
        priorityScore: Number(priorityScore.toFixed(1)),
        priority: priorityScore >= 20 ? 'high' : priorityScore >= 8 ? 'medium' : 'low'
      };
    })
    .sort((left, right) => right.priorityScore - left.priorityScore);

  return { total: items.length, items: items.slice(0, limit) };
}
