/**
 * Content Search — full-text search across every processed page.
 */
import { api, ApiError } from '../api.js';
import { el, formatNumber, highlightSnippet } from '../util.js';
import { card, emptyState, pageHeader } from './common.js';

export async function render(params = {}) {
  const node = el('div.view');
  const resultsHost = el('div');

  const input = el('input', {
    type: 'search',
    placeholder: 'e.g. Tiger Balm, INV-, container number, batch…',
    value: params.q ?? ''
  });

  async function runSearch() {
    const term = input.value.trim();
    if (term.length < 2) {
      resultsHost.replaceChildren(emptyState('Enter a search term', 'Type at least two characters to search across every processed document.'));
      return;
    }

    resultsHost.replaceChildren(el('p.text-muted', { text: 'Searching…' }));
    let response;
    try {
      response = await api.search(term);
    } catch (error) {
      resultsHost.replaceChildren(
        emptyState('Search failed', error instanceof ApiError ? error.message : 'Unexpected error.', undefined, 'alert')
      );
      return;
    }

    if (response.results.length === 0) {
      resultsHost.replaceChildren(
        emptyState('No matches', `"${term}" was not found in any processed document.`, undefined, 'info')
      );
      return;
    }

    const cards = response.results.map((result) =>
      el('article.result-card', {}, [
        el('div.result-card__head', {}, [
          el('a', { href: `#/documents/${result.documentId}`, text: result.fileName, style: { fontWeight: '700' } }),
          el('span.badge.badge--info', { text: result.typeName }),
          result.businessUnit ? el('span.badge.badge--neutral', { text: result.businessUnit }) : null,
          el('span.badge.badge--success', { text: `${formatNumber(result.occurrences)} match(es)` }),
          el('span.text-muted', { text: `${formatNumber(result.pageCount)} pages`, style: { marginLeft: 'auto' } })
        ]),
        ...result.hits.map((hit) =>
          el('div.cell-stack', {}, [
            highlightSnippet(hit.snippet, term),
            el('span.field-row__raw', { text: `page ${hit.pageNumber}` })
          ])
        )
      ])
    );

    resultsHost.replaceChildren(
      el('p.text-muted', { text: `${formatNumber(response.total ?? response.results.length)} document(s) matched "${term}".`, style: { marginBottom: '12px' } }),
      ...cards
    );
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runSearch();
  });

  node.append(
    pageHeader({
      title: 'Content Search',
      icon: 'search',
      subtitle: 'Search inside the recognised text of every page — including 100+ page annual reports and scanned contracts.'
    }),
    card({
      body: el('div.filter-bar', {}, [
        el('div.field.field--grow', {}, [el('label', { text: 'Search term' }), input]),
        el('button.btn.btn--primary', { type: 'button', text: 'Search', on: { click: () => runSearch() } })
      ])
    }),
    el('div', { style: { height: '16px' } }),
    resultsHost
  );

  if ((params.q ?? '').trim().length >= 2) await runSearch();
  else resultsHost.replaceChildren(emptyState('Enter a search term', 'Type at least two characters to search across every processed document.'));

  setTimeout(() => input.focus(), 0);
  return { node };
}
