/**
 * Ingest Documents — drag-and-drop upload, VGC sample pack and live pipeline progress.
 */
import { api, ApiError } from '../api.js';
import { refreshCounters, state, subscribe } from '../store.js';
import { el, formatBytes, formatTime, statusBadge, toast } from '../util.js';
import { icon } from '../icons.js';
import { card, dataTable, pageHeader } from './common.js';

const PIPELINE_POLL_MS = 4000;
const PIPELINE_COALESCE_MS = 900;

function dropzone(onFiles, limits) {
  const input = el('input', {
    type: 'file',
    multiple: true,
    accept: (limits?.allowedExtensions ?? []).join(','),
    style: { display: 'none' },
    on: {
      change: (event) => {
        const files = [...event.target.files];
        event.target.value = '';
        if (files.length > 0) onFiles(files);
      }
    }
  });

  const zone = el('div.dropzone', { role: 'button', tabIndex: 0 }, [
    el('div.dropzone__icon', {}, [icon('upload', { size: 26, strokeWidth: 1.6 })]),
    el('p', { text: 'Drag documents here, or click to browse' }),
    el('p.text-muted', {
      text: `Up to ${limits?.maxFilesPerRequest ?? 20} files per batch · ${limits?.maxUploadMb ?? 100} MB each · ${limits?.maxPagesPerDocument ?? 2000} pages per document`
    }),
    el('p.text-muted.mono', { text: (limits?.allowedExtensions ?? []).join('  ') }),
    input
  ]);

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  ['dragenter', 'dragover'].forEach((name) =>
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.add('is-dragging');
    })
  );
  ['dragleave', 'drop'].forEach((name) =>
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.remove('is-dragging');
    })
  );
  zone.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0) onFiles(files);
  });

  return zone;
}

function sampleCard(sample, selected, onToggle) {
  const checkbox = el('input', {
    type: 'checkbox',
    checked: selected.has(sample.id),
    on: { change: (event) => onToggle(sample.id, event.target.checked) }
  });

  return el('article.sample-card', {}, [
    el('label.switch', {}, [checkbox, el('span.sample-card__title', { text: sample.typeId.replace(/_/g, ' ') })]),
    el('span.sample-card__file', { text: sample.fileName }),
    el('span.sample-card__desc', { text: sample.description }),
    el('div.sample-card__actions', {}, [
      el('a.btn.btn--ghost.btn--sm', {
        href: `/api/samples/${encodeURIComponent(sample.id)}/download`,
        text: 'Download PDF'
      }),
      el('button.btn.btn--primary.btn--sm', {
        type: 'button',
        text: 'Process',
        on: {
          click: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = 'Queued…';
            try {
              await api.runSamples([sample.id]);
              toast(`${sample.fileName} queued for processing.`, 'success');
              await refreshCounters();
            } catch (error) {
              toast(error instanceof ApiError ? error.message : 'Could not queue the sample.', 'error');
            } finally {
              button.disabled = false;
              button.textContent = 'Process';
            }
          }
        }
      })
    ])
  ]);
}

export async function render() {
  const node = el('div.view');
  const config = state.config ?? (await api.getConfig());
  const selected = new Set(config.samples.map((sample) => sample.id));

  const recentBody = el('div');

  async function paintRecent() {
    try {
      const [listing, pipeline] = await Promise.all([
        api.listDocuments({ pageSize: 12, sort: 'uploadedAt:desc' }),
        api.getPipelineStatus()
      ]);

      const summary = el('div.row', { style: { marginBottom: '12px' } }, [
        el('span.badge.badge--info', { text: `Queue depth ${pipeline.queueDepth}` }),
        el('span.badge.badge--neutral', { text: `Workers ${pipeline.activeWorkers}/${pipeline.concurrency}` }),
        el('span.badge.badge--success', { text: `Processed ${pipeline.processedCount}` }),
        el('span.badge.badge--danger', { text: `Failed ${pipeline.failedCount}` })
      ]);

      const table = dataTable(
        [
          { label: 'File' },
          { label: 'Type' },
          { label: 'Pages', numeric: true },
          { label: 'Size', numeric: true },
          { label: 'Status' },
          { label: 'Uploaded' }
        ],
        listing.items.map((item) => [
          el('a', { href: `#/documents/${item.id}`, text: item.fileName }),
          item.typeName ?? '—',
          String(item.pageCount ?? 0),
          formatBytes(item.fileSize),
          statusBadge(item.status),
          formatTime(item.uploadedAt)
        ]),
        { emptyMessage: 'No documents have been submitted yet.', label: 'Recent submissions' }
      );

      recentBody.replaceChildren(summary, table);
    } catch (error) {
      recentBody.replaceChildren(el('p.text-muted', { text: 'Could not load recent submissions.' }));
    }
  }

  async function uploadFiles(files) {
    toast(`Uploading ${files.length} file(s)…`, 'info');
    try {
      const result = await api.upload(files, 'Manual upload');
      toast(`${result.acceptedCount} accepted, ${result.rejectedCount} rejected.`, result.rejectedCount > 0 ? 'warn' : 'success');
      for (const rejection of result.rejected ?? []) toast(`${rejection.fileName}: ${rejection.message}`, 'error', 7000);
      await refreshCounters();
      await paintRecent();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Upload failed.', 'error', 7000);
    }
  }

  const sampleGrid = el(
    'div.sample-grid',
    {},
    config.samples.map((sample) =>
      sampleCard(sample, selected, (id, checked) => (checked ? selected.add(id) : selected.delete(id)))
    )
  );

  const runSelected = el('button.btn.btn--accent', {
    type: 'button',
    text: 'Run selected samples',
    on: {
      click: async (event) => {
        const button = event.currentTarget;
        if (selected.size === 0) return toast('Select at least one sample first.', 'warn');
        button.disabled = true;
        button.textContent = 'Generating PDFs…';
        try {
          const result = await api.runSamples([...selected]);
          toast(`${result.acceptedCount} sample document(s) queued.`, 'success');
          await refreshCounters();
          await paintRecent();
        } catch (error) {
          toast(error instanceof ApiError ? error.message : 'Could not run the sample pack.', 'error');
        } finally {
          button.disabled = false;
          button.textContent = 'Run selected samples';
        }
      }
    }
  });

  node.append(
    pageHeader({
      title: 'Ingest Documents',
      icon: 'upload',
      subtitle: 'Submit VGC operational documents of any length or layout. Every file is validated, analysed, classified, extracted and rule-checked automatically.',
      actions: [runSelected]
    }),
    card({
      title: 'Upload from your machine',
      icon: 'upload',
      tone: 'amber',
      subtitle: 'PDF, scanned images, TIFF and Office formats are supported',
      body: dropzone(uploadFiles, config.limits)
    }),
    el('div', { style: { height: '16px' } }),
    card({
      title: 'VGC sample document pack',
      icon: 'layers',
      tone: 'violet',
      subtitle: 'Real, generated PDFs covering every supported document type — including a 100+ page annual report',
      body: sampleGrid
    }),
    el('div', { style: { height: '16px' } }),
    card({ title: 'Recent submissions', icon: 'clock', body: recentBody })
  );

  await paintRecent();

  // The pipeline emits an event per stage per document. Repainting on every one
  // of them would issue two API calls per stage; coalesce them into one refresh.
  let coalesceTimer = null;
  const schedulePaint = () => {
    if (coalesceTimer !== null) return;
    coalesceTimer = setTimeout(() => {
      coalesceTimer = null;
      paintRecent().catch(() => {});
    }, PIPELINE_COALESCE_MS);
  };

  const unsubscribe = subscribe((unused, reason) => {
    if (reason === 'pipeline') schedulePaint();
  });
  const timer = setInterval(() => schedulePaint(), PIPELINE_POLL_MS);

  return {
    node,
    cleanup: () => {
      unsubscribe();
      clearInterval(timer);
      if (coalesceTimer !== null) clearTimeout(coalesceTimer);
    }
  };
}
