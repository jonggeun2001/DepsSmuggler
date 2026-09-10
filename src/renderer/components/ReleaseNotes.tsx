import { message } from 'antd';
import DOMPurify from 'dompurify';
import { useCallback } from 'react';
import type { UpdateReleaseNotes } from '../../types/updater';
import './ReleaseNotes.css';

const ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'hr',
  'i',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'strong',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
];
const ALLOWED_ATTR = ['href', 'title', 'start', 'colspan', 'rowspan'];
const HTTP_URL = /^https?:\/\//i;

interface ReleaseNotesProps {
  releaseNotes?: UpdateReleaseNotes;
}

function sanitize(note: string): string {
  return DOMPurify.sanitize(note, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: HTTP_URL,
    // Numeric list/table attributes must not be filtered as HTTP URLs.
    ADD_URI_SAFE_ATTR: ['start', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

function releaseNoteEntries(releaseNotes: UpdateReleaseNotes) {
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .filter(
        (entry): entry is { version: string; note: string } =>
          typeof entry.note === 'string' && entry.note.trim().length > 0
      )
      .map((entry) => ({ version: entry.version, note: entry.note }));
  }
  if (typeof releaseNotes === 'string' && releaseNotes.trim().length > 0) {
    return [{ version: undefined, note: releaseNotes }];
  }
  return [];
}

function isSafeHttpUrl(value: string): boolean {
  if (!HTTP_URL.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ReleaseNotes({ releaseNotes }: ReleaseNotesProps) {
  const entries = releaseNoteEntries(releaseNotes);

  const openLink = useCallback((event: React.SyntheticEvent<HTMLElement>) => {
    if (event.type === 'auxclick' && (event as React.MouseEvent<HTMLElement>).button !== 1) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a');
    if (!link) return;

    event.preventDefault();
    event.stopPropagation();
    const href = link.getAttribute('href');
    if (!href || !isSafeHttpUrl(href)) return;

    const openReleaseNotesLink = window.electronAPI?.updater?.openReleaseNotesLink;
    if (!openReleaseNotesLink) return;
    void openReleaseNotesLink(href)
      .then((result) => {
        if (!result.success) {
          message.error(result.error ?? '릴리즈 노트 링크를 열 수 없습니다.');
        }
      })
      .catch(() => message.error('릴리즈 노트 링크를 열 수 없습니다.'));
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      openLink(event);
    },
    [openLink]
  );

  if (entries.length === 0) return null;

  return (
    <div
      className="release-notes"
      data-testid="release-notes"
      onClick={openLink}
      onAuxClick={openLink}
      onKeyDown={handleKeyDown}
    >
      {entries.map((entry, index) => (
        <section className="release-notes__entry" key={`${entry.version ?? 'note'}-${index}`}>
          {entry.version && <h4 className="release-notes__version">v{entry.version}</h4>}
          {/<[a-z][^>]*>/i.test(entry.note) ? (
            <div dangerouslySetInnerHTML={{ __html: sanitize(entry.note) }} />
          ) : (
            <div className="release-notes__body--plain">{entry.note}</div>
          )}
        </section>
      ))}
    </div>
  );
}
