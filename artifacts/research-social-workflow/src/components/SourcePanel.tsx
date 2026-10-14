import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Search, Pencil, Plus, Trash2, X } from "lucide-react";
import type { ContentSource, SourceInput, SourceUpdate } from "@workspace/api-client-react";

type SourcePanelProps = {
  sources: ContentSource[];
  isLoading: boolean;
  error: boolean;
  saving: boolean;
  onRetry: () => void;
  onSave: (data: SourceInput | SourceUpdate, id?: number) => void;
  onDelete: (source: ContentSource) => void;
};

export function SourcePanel({
  sources,
  isLoading,
  error,
  saving,
  onRetry,
  onSave,
  onDelete,
}: SourcePanelProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContentSource | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [formError, setFormError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sources.filter((s) => `${s.title} ${s.sourceUrl ?? ""}`.toLowerCase().includes(q)) : sources;
  }, [sources, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const openNew = () => {
    setEditing(null);
    setTitle("");
    setContent("");
    setSourceUrl("");
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (source: ContentSource) => {
    setEditing(source);
    setTitle(source.title);
    setContent(source.content);
    setSourceUrl(source.sourceUrl ?? "");
    setFormError("");
    setModalOpen(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || content.trim().length < 20) {
      setFormError("Add a title and at least 20 characters of source material.");
      return;
    }
    const payload = {
      title: title.trim(),
      content: content.trim(),
      sourceUrl: editing ? sourceUrl.trim() || null : sourceUrl.trim() || undefined,
    };
    onSave(payload, editing?.id);
    setModalOpen(false);
  };

  return (
    <section className="panel content-section" id="sources" data-testid="section-sources">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Source library</h2>
          <div className="panel-subtitle">House articles and primers, ready to adapt.</div>
        </div>
        <button
          className="button button-primary button-small"
          onClick={openNew}
          data-testid="button-add-source"
        >
          <Plus size={14} />
          Add source
        </button>
      </div>
      {isLoading ? (
        <div className="loading-state" data-testid="loading-sources">
          <div className="skeleton" style={{ width: "62%", margin: "0 auto 10px" }} />
          <div className="skeleton" style={{ width: "40%", margin: "0 auto" }} />
        </div>
      ) : error ? (
        <div className="error-state" data-testid="error-sources">
          Source library could not be loaded.
          <div style={{ marginTop: 10 }}>
            <button className="button button-small" onClick={onRetry} data-testid="button-retry-sources">
              Retry
            </button>
          </div>
        </div>
      ) : sources.length === 0 ? (
        <div className="empty-state" data-testid="empty-sources">
          <div className="empty-icon">
            <FileText size={16} />
          </div>
          <strong>No source material yet</strong>
          <div style={{ marginTop: 5 }}>Save a house article or primer to start a draft.</div>
        </div>
      ) : (
        <>
        <div className="history-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            className="input"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search saved articles"
            aria-label="Search saved articles"
            data-testid="input-search-sources"
          />
        </div>
        {filtered.length === 0 && <div className="empty-state" data-testid="empty-source-search"><strong>No articles match “{query}”</strong></div>}
        <div className="source-list">
          {visible.map((source) => (
            <article className="source-row" key={source.id} data-testid={`source-row-${source.id}`}>
              <div>
                <div className="source-title" title={source.title} data-testid={`source-title-${source.id}`}>
                  {source.title}
                </div>
                <div className="source-info">
                  <span>{new Date(source.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  <span>·</span>
                  <span>{source.content.trim().split(/\s+/).filter(Boolean).length} words</span>
                  {source.sourceUrl && (
                    <>
                      <span>·</span>
                      <a
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="provider-link"
                        data-testid={`link-source-${source.id}`}
                      >
                        Original
                        <ExternalLink size={10} />
                      </a>
                    </>
                  )}
                </div>
              </div>
              <div className="source-actions">
                <button
                  className="icon-button"
                  aria-label={`Edit ${source.title}`}
                  onClick={() => openEdit(source)}
                  data-testid={`button-edit-source-${source.id}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Delete ${source.title}`}
                  onClick={() => onDelete(source)}
                  data-testid={`button-delete-source-${source.id}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
        {filtered.length > pageSize && (
          <nav className="history-pager" aria-label="Source library pages">
            <span aria-live="polite">{(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}</span>
            <div>
              <button className="button button-small" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} data-testid="button-sources-prev"><ChevronLeft size={14} />Previous</button>
              <button className="button button-small" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)} data-testid="button-sources-next">Next<ChevronRight size={14} /></button>
            </div>
          </nav>
        )}
        </>
      )}
      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setModalOpen(false);
          }
        }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="source-modal-title">
            <div className="modal-head">
              <div>
                <div className="eyebrow">Source material</div>
                <h2 className="panel-title" id="source-modal-title" style={{ marginTop: 5 }}>
                  {editing ? "Edit source" : "Save a source"}
                </h2>
              </div>
              <button className="icon-button" onClick={() => setModalOpen(false)} aria-label="Close" data-testid="button-close-source-modal">
                <X size={16} />
              </button>
            </div>
            <form className="modal-body source-form" onSubmit={submit}>
              <div className="field">
                <label htmlFor="source-title">Working title</label>
                <input
                  id="source-title"
                  className="input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  required
                  placeholder="e.g. A field guide to urban heat"
                  data-testid="input-source-title"
                />
              </div>
              <div className="field">
                <label htmlFor="source-content">Pasted article or primer</label>
                <textarea
                  id="source-content"
                  className="textarea source-content"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  minLength={20}
                  maxLength={100000}
                  required
                  placeholder="Paste the research material you want to adapt."
                  data-testid="textarea-source-content"
                />
                <span className="form-hint">{content.length.toLocaleString()} / 100,000 characters</span>
              </div>
              <div className="field">
                <label htmlFor="source-url">Original source link <span>(optional)</span></label>
                <input
                  id="source-url"
                  className="input"
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://journal.example.org/article"
                  data-testid="input-source-url"
                />
              </div>
              {formError && <div className="error-inline" data-testid="error-source-form">{formError}</div>}
              <div className="form-actions">
                <span className="form-hint">This version has no sign-in; save only material cleared for this workspace.</span>
                <button type="submit" className="button button-primary" disabled={saving} data-testid="button-save-source">
                  {saving ? "Saving…" : editing ? "Save changes" : "Save source"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
