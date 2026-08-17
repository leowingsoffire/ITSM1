/**
 * copilot.js — the floating AI Copilot panel.
 *
 * Three surfaces in one glass panel:
 *   • Chat      — a grounded assistant that answers from live platform state
 *                 and routes the operator to the right view.
 *   • Tasks     — what currently needs a human, derived from the review queue
 *                 and claim exceptions.
 *   • Analytics — the live pipeline telemetry at a glance.
 *
 * The assistant is deliberately *grounded*: it never invents figures. Every
 * number it reports comes from the store or the API, and when it cannot answer
 * from real data it says so and offers a route instead.
 *
 * Voice input uses the browser's built-in SpeechRecognition when available and
 * degrades to a disabled button when it is not.
 */

import { api } from './api.js';
import { icon } from './icons.js';
import { refreshCounters, state, subscribe } from './store.js';
import { el, formatNumber, toast } from './util.js';

/* ==========================================================================
   Grounded intent handling
   ========================================================================== */

/**
 * Each intent matches on keywords and answers purely from platform state.
 * `answer` may return a string or a Promise<string>.
 */
const INTENTS = [
  {
    keys: ['review', 'queue', 'exception', 'attention', 'pending'],
    answer: async () => {
      await refreshCounters().catch(() => {});
      const n = state.reviewCount;
      if (n === 0) return 'The review queue is clear — every document cleared its validation rules.';
      return `${formatNumber(n)} document${n === 1 ? '' : 's'} need a human decision. Opening the review queue for you.`;
    },
    route: () => (state.reviewCount > 0 ? '#/review' : null)
  },
  {
    keys: ['claim', 'a&p', 'ap code', 'marketing', 'distributor', 'budget'],
    answer: async () => {
      const claims = await api.listClaims();
      const overview = claims?.overview ?? {};
      const total = overview.totalClaims ?? claims?.claims?.length ?? 0;
      const flagged = overview.reviewClaims ?? 0;
      if (total === 0) return 'No A&P claims have been ingested yet. Run a sample from the Ingest view to see reconciliation in action.';
      return `${formatNumber(total)} A&P claim${total === 1 ? '' : 's'} are loaded and ${formatNumber(flagged)} need review. `
        + 'I check invoice dates, amounts to the dollar, A&P code alignment and product-type summation against the annual budget.';
    },
    route: () => '#/claims'
  },
  {
    keys: ['document', 'library', 'how many', 'processed', 'ingested'],
    answer: async () => {
      await refreshCounters().catch(() => {});
      return `${formatNumber(state.documentCount)} document${state.documentCount === 1 ? '' : 's'} are in the library. `
        + `The pipeline has processed ${formatNumber(state.pipeline?.processedCount ?? 0)} and failed ${formatNumber(state.pipeline?.failedCount ?? 0)} this session.`;
    },
    route: () => '#/documents'
  },
  {
    keys: ['upload', 'ingest', 'add', 'new file', 'scan'],
    answer: () => 'Drop a PDF or image into the ingest zone, or run one of the packaged samples. I will classify it, extract fields and apply the rule set automatically.',
    route: () => '#/ingest'
  },
  {
    keys: ['cost', 'spend', 'price', 'saving', 'roi', 'value'],
    answer: () => 'Cost and value tracks per-page analysis spend against the manual baseline, so you can see the payback on every batch.',
    route: () => '#/cost'
  },
  {
    keys: ['engine', 'azure', 'model', 'analyzer', 'ocr'],
    answer: () => {
      const analyzer = state.config?.analyzer;
      if (!analyzer) return 'I could not read the analyzer configuration yet — give the platform a moment to finish starting.';
      return analyzer.mode === 'azure'
        ? `Running on Azure AI Document Intelligence, model ${analyzer.modelId}, API ${analyzer.apiVersion}, authenticating with ${analyzer.authentication}.`
        : 'Running the offline demo engine — full functionality with zero Azure spend. Set ANALYZER_MODE=azure to switch to the live service.';
    }
  },
  {
    keys: ['search', 'find', 'look for'],
    answer: () => 'Use the search bar at the top to run full-text search across every processed page. I will take you to the search view.',
    route: () => '#/search'
  },
  {
    keys: ['architecture', 'blueprint', 'design', 'how does'],
    answer: () => 'The solution blueprint lays out the full reference architecture — ingestion, analysis, extraction, validation and export.',
    route: () => '#/blueprint'
  },
  {
    keys: ['export', 'excel', 'xlsx', 'workbook', 'download'],
    answer: () => 'Every claim and the full document library export to Excel. Use the workbook button in the sidebar, or the export action on any claim.'
  },
  {
    keys: ['help', 'what can you', 'hello', 'hi ', 'hey'],
    answer: () => 'I can report on the review queue, A&P claim reconciliation, document volumes, pipeline health, cost and the analysis engine — and take you straight to any view. Ask away.'
  }
];

const FALLBACK = 'I only answer from live platform state, so I would rather not guess at that one. '
  + 'Try asking about the review queue, A&P claims, document volumes, cost, or the analysis engine.';

function matchIntent(text) {
  const q = text.toLowerCase();
  return INTENTS.find((intent) => intent.keys.some((key) => q.includes(key))) ?? null;
}

/* ==========================================================================
   Panel construction
   ========================================================================== */

function bubble(role, content) {
  const isMe = role === 'me';
  return el(`div.copilot__msg.copilot__msg--${isMe ? 'me' : 'ai'}`, {}, [
    el('span.copilot__pip', { text: isMe ? 'YOU' : 'AI', 'aria-hidden': 'true' }),
    el('div.copilot__bubble', typeof content === 'string' ? { text: content } : {}, typeof content === 'string' ? [] : [content])
  ]);
}

function typingBubble() {
  return bubble('ai', el('span.copilot__typing', { 'aria-hidden': 'true' }, [el('i'), el('i'), el('i')]));
}

function waveform(bars = 22) {
  return el('div.waveform', { 'aria-hidden': 'true' }, Array.from({ length: bars }, () => el('i')));
}

/**
 * Mounts the copilot FAB and panel onto the page.
 * @returns {Function} destroy
 */
export function mountCopilot() {
  /* ---- chat pane -------------------------------------------------------- */
  const thread = el('div.copilot__pane', { role: 'log', 'aria-live': 'polite' }, [
    bubble('ai', 'Welcome back. The workspace is live — ask me about the review queue, A&P claims or pipeline health.')
  ]);

  /* ---- tasks pane ------------------------------------------------------- */
  const tasksPane = el('div.copilot__pane', { hidden: true });

  function paintTasks() {
    const items = [];
    if (state.reviewCount > 0) {
      items.push({
        iconName: 'review',
        title: `${formatNumber(state.reviewCount)} document${state.reviewCount === 1 ? '' : 's'} awaiting review`,
        detail: 'Validation rules raised an exception that needs a human decision.',
        href: '#/review'
      });
    }
    if (state.claimsReview > 0) {
      items.push({
        iconName: 'scale',
        title: `${formatNumber(state.claimsReview)} A&P claim${state.claimsReview === 1 ? '' : 's'} flagged`,
        detail: 'Date, amount, A&P code or product-type summation did not reconcile.',
        href: '#/claims'
      });
    }
    if ((state.pipeline?.failedCount ?? 0) > 0) {
      items.push({
        iconName: 'alert',
        title: `${formatNumber(state.pipeline.failedCount)} pipeline failure${state.pipeline.failedCount === 1 ? '' : 's'}`,
        detail: 'Re-ingest the affected files from the ingest view.',
        href: '#/ingest'
      });
    }
    if ((state.pipeline?.queueDepth ?? 0) > 0) {
      items.push({
        iconName: 'clock',
        title: `${formatNumber(state.pipeline.queueDepth)} in the queue`,
        detail: `${formatNumber(state.pipeline.activeWorkers ?? 0)} worker(s) active right now.`,
        href: '#/dashboard'
      });
    }

    tasksPane.replaceChildren(
      ...(items.length > 0
        ? items.map((task) => el('a.copilot__task', { href: task.href }, [
            icon(task.iconName, { size: 16 }),
            el('div', {}, [el('strong', { text: task.title }), el('span', { text: task.detail })])
          ]))
        : [el('div.copilot__task', {}, [
            icon('checkCircle', { size: 16 }),
            el('div', {}, [
              el('strong', { text: 'Nothing needs you right now' }),
              el('span', { text: 'Every document cleared validation and the queue is empty.' })
            ])
          ])])
    );
  }

  /* ---- analytics pane --------------------------------------------------- */
  const analyticsPane = el('div.copilot__pane', { hidden: true });

  function paintAnalytics() {
    const rows = [
      ['Documents in library', formatNumber(state.documentCount)],
      ['Awaiting review', formatNumber(state.reviewCount)],
      ['Claims flagged', formatNumber(state.claimsReview)],
      ['Queue depth', formatNumber(state.pipeline?.queueDepth ?? 0)],
      ['Active workers', formatNumber(state.pipeline?.activeWorkers ?? 0)],
      ['Processed this session', formatNumber(state.pipeline?.processedCount ?? 0)],
      ['Failed this session', formatNumber(state.pipeline?.failedCount ?? 0)]
    ];
    const total = state.documentCount || 1;
    const cleanShare = Math.max(0, Math.min(100, ((total - state.reviewCount) / total) * 100));

    analyticsPane.replaceChildren(
      el('div.copilot__stat', {}, rows.map(([label, value]) =>
        el('div.copilot__stat-row', {}, [el('span', { text: label }), el('b', { text: value })])
      )),
      el('div', { style: { marginTop: '14px' } }, [
        el('div.copilot__stat-row', {}, [
          el('span', { text: 'Straight-through rate' }),
          el('b', { text: `${cleanShare.toFixed(1)}%` })
        ]),
        el('div.meter', { style: { marginTop: '8px' } }, [
          el('div.meter__fill.meter__fill--success', { style: { width: `${cleanShare}%` } })
        ])
      ])
    );
  }

  /* ---- composer --------------------------------------------------------- */
  const field = el('input', {
    type: 'text',
    placeholder: 'Ask the copilot…',
    autocomplete: 'off',
    'aria-label': 'Ask the AI copilot'
  });

  const wave = waveform();

  const micButton = el('button.copilot__mic', {
    type: 'button',
    title: 'Voice input',
    'aria-label': 'Voice input'
  }, [
    icon('mic', { size: 17 }),
    el('span.mic-rings', { 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')])
  ]);

  const sendButton = el('button.copilot__send', {
    type: 'button',
    title: 'Send',
    'aria-label': 'Send message'
  }, [icon('send', { size: 17 })]);

  const avatar = el('div.copilot__avatar', { 'aria-hidden': 'true' }, [icon('brain', { size: 20 })]);

  let busy = false;

  async function ask(text) {
    const question = text.trim();
    if (!question || busy) return;
    busy = true;
    field.value = '';

    thread.append(bubble('me', question));
    const pending = typingBubble();
    thread.append(pending);
    thread.parentElement.scrollTop = thread.parentElement.scrollHeight;

    // The assistant visibly thinks: energy waves and orbiting particles.
    avatar.classList.add('is-thinking');

    const intent = matchIntent(question);
    let reply = FALLBACK;
    let route = null;
    try {
      if (intent) {
        reply = await intent.answer();
        route = intent.route ? intent.route() : null;
      }
    } catch (error) {
      reply = `I could not reach the platform API just then — ${error?.message ?? 'unknown error'}.`;
    }

    // A short beat so the exchange reads as a conversation rather than a lookup.
    await new Promise((done) => setTimeout(done, 420));

    avatar.classList.remove('is-thinking');
    pending.remove();
    thread.append(bubble('ai', reply));
    if (route) {
      thread.append(el('div.copilot__msg.copilot__msg--ai', {}, [
        el('span.copilot__pip', { text: 'AI', 'aria-hidden': 'true' }),
        el('a.btn.btn--ghost', { href: route, style: { fontSize: '12px' } }, [
          el('span', { text: 'Open that view' }),
          icon('chevronRight', { size: 14 })
        ])
      ]));
    }
    thread.parentElement.scrollTop = thread.parentElement.scrollHeight;
    busy = false;
  }

  sendButton.addEventListener('click', () => ask(field.value));
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') ask(field.value);
  });

  /* ---- voice ------------------------------------------------------------ */
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recogniser = null;

  if (!SpeechRecognition) {
    micButton.disabled = true;
    micButton.title = 'Voice input is not supported in this browser';
  } else {
    micButton.addEventListener('click', () => {
      if (recogniser) {
        recogniser.stop();
        return;
      }
      recogniser = new SpeechRecognition();
      recogniser.lang = 'en-SG';
      recogniser.interimResults = false;
      recogniser.maxAlternatives = 1;

      const stopVisuals = () => {
        micButton.classList.remove('is-live');
        wave.classList.remove('is-live');
        recogniser = null;
      };

      recogniser.addEventListener('result', (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript ?? '';
        if (transcript) ask(transcript);
      });
      recogniser.addEventListener('error', (event) => {
        toast(`Voice input failed: ${event.error ?? 'unknown error'}`, 'warn');
        stopVisuals();
      });
      recogniser.addEventListener('end', stopVisuals);

      try {
        recogniser.start();
        micButton.classList.add('is-live');
        wave.classList.add('is-live');
      } catch {
        stopVisuals();
      }
    });
  }

  /* ---- tabs and shell --------------------------------------------------- */
  const panes = { chat: thread, tasks: tasksPane, analytics: analyticsPane };
  const tabDefs = [
    { key: 'chat', label: 'Chat', iconName: 'chat' },
    { key: 'tasks', label: 'Tasks', iconName: 'tasks' },
    { key: 'analytics', label: 'Analytics', iconName: 'chart' }
  ];

  const tabButtons = tabDefs.map((def) => el(
    `button.copilot__tab${def.key === 'chat' ? '.is-active' : ''}`,
    { type: 'button', 'aria-pressed': def.key === 'chat' ? 'true' : 'false' },
    [icon(def.iconName, { size: 14 }), el('span', { text: def.label })]
  ));

  function selectTab(key) {
    tabDefs.forEach((def, index) => {
      const active = def.key === key;
      tabButtons[index].classList.toggle('is-active', active);
      tabButtons[index].setAttribute('aria-pressed', active ? 'true' : 'false');
      panes[def.key].hidden = !active;
    });
    if (key === 'tasks') paintTasks();
    if (key === 'analytics') paintAnalytics();
  }

  tabDefs.forEach((def, index) => {
    tabButtons[index].addEventListener('click', () => selectTab(def.key));
  });

  const closeButton = el('button.copilot__close', {
    type: 'button',
    title: 'Close copilot',
    'aria-label': 'Close copilot'
  }, [icon('close', { size: 16 })]);

  const panel = el('aside.copilot', {
    'aria-label': 'AI Copilot',
    'aria-hidden': 'true'
  }, [
    el('header.copilot__header', {}, [
      avatar,
      el('div.copilot__title', {}, [
        el('strong', { text: 'VGC Copilot' }),
        el('span', { text: 'Grounded in live platform state' })
      ]),
      closeButton
    ]),
    el('div.copilot__tabs', {}, tabButtons),
    el('div.copilot__body', {}, [thread, tasksPane, analyticsPane]),
    el('footer.copilot__footer', {}, [
      wave,
      el('div.copilot__composer', {}, [field, micButton, sendButton])
    ])
  ]);

  const fab = el('button.copilot-fab', {
    type: 'button',
    title: 'AI Copilot',
    'aria-label': 'Open the AI copilot',
    'aria-expanded': 'false'
  }, [icon('sparkles', { size: 22 })]);

  function setOpen(open) {
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    fab.classList.toggle('is-open', open);
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    fab.setAttribute('aria-label', open ? 'Close the AI copilot' : 'Open the AI copilot');
    if (open) {
      paintTasks();
      paintAnalytics();
      requestAnimationFrame(() => field.focus());
    }
  }

  fab.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
  closeButton.addEventListener('click', () => setOpen(false));

  const onKey = (event) => {
    if (event.key === 'Escape' && panel.classList.contains('is-open')) setOpen(false);
    // Ctrl/Cmd + K summons the copilot from anywhere.
    if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 'k') {
      event.preventDefault();
      setOpen(!panel.classList.contains('is-open'));
    }
  };
  document.addEventListener('keydown', onKey);

  // Keep the tasks and analytics panes honest as state changes.
  const unsubscribe = subscribe(() => {
    if (!panel.classList.contains('is-open')) return;
    if (!tasksPane.hidden) paintTasks();
    if (!analyticsPane.hidden) paintAnalytics();
  });

  document.body.append(panel, fab);
  selectTab('chat');

  return function destroy() {
    document.removeEventListener('keydown', onKey);
    unsubscribe();
    if (recogniser) {
      try { recogniser.abort(); } catch { /* already stopped */ }
    }
    panel.remove();
    fab.remove();
  };
}
