import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Campaign, CampaignReviewUpdate, PlatformDraft } from "@workspace/api-client-react";
import { CampaignCard } from "./CampaignPanel";

type Props = {
  campaigns: Campaign[];
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;
  onReview: (campaign: Campaign, update: CampaignReviewUpdate) => void;
  savingId: number | null;
};

const platformNames: Record<string, string> = {
  linkedin: "LinkedIn", facebook: "Facebook", bluesky: "Bluesky",
  substack: "Substack Note", x: "X", instagram: "Instagram",
};
const PAGE_SIZE = 6;

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function CampaignHistory({ campaigns, isLoading, error, onRetry, onReview, savingId }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const draftCache = useRef(new Map<number, PlatformDraft[]>());
  // Cards opened once stay mounted (hidden) so unsaved edits survive collapsing.
  const [opened, setOpened] = useState<number[]>([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter((c) =>
      [c.sourceTitle, fmt(c.updatedAt), ...c.platforms.map((p) => platformNames[p] ?? p)].join(" ").toLowerCase().includes(q));
  }, [campaigns, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pageIds = new Set(pageItems.map((c) => c.id));

  const toggle = (id: number) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setOpened((cur) => (cur.includes(id) ? cur : [...cur, id]));
  };

  const card = (c: Campaign) => (
    <CampaignCard
      campaign={c}
      onReview={onReview}
      saving={savingId === c.id}
      initialDrafts={draftCache.current.get(c.id)}
      onDraftsChange={(drafts) => { draftCache.current.set(c.id, drafts); }}
    />
  );

  let body;
  if (isLoading) {
    body = (
      <div className="loading-state" data-testid="loading-campaigns">
        <div className="skeleton" style={{ width: "86%", margin: "0 auto 10px" }} />
        <div className="skeleton" style={{ width: "60%", margin: "0 auto" }} />
      </div>
    );
  } else if (error) {
    body = (
      <div className="error-state" data-testid="error-campaigns">
        Posts could not be loaded.
        <div style={{ marginTop: 10 }}>
          <button className="button button-small" onClick={onRetry} data-testid="button-retry-campaigns">Retry</button>
        </div>
      </div>
    );
  } else if (campaigns.length === 0) {
    body = <div className="empty-state" data-testid="empty-campaigns"><strong>No posts saved yet</strong></div>;
  } else {
    body = (
      <>
        <div className="history-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search" className="input" value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search by article, platform or date"
            aria-label="Search post history" data-testid="input-search-campaigns"
          />
        </div>
        {filtered.length === 0 && (
          <div className="empty-state" data-testid="empty-campaign-search"><strong>No posts match “{query}”</strong></div>
        )}
        <ul className="history-list">
          {pageItems.map((c) => {
            const open = expandedId === c.id;
            return (
              <li key={c.id} className={`history-item${open ? " is-open" : ""}`}>
                <button
                  type="button" className="history-summary" aria-expanded={open}
                  aria-controls={`history-detail-${c.id}`} onClick={() => toggle(c.id)}
                  data-testid={`button-toggle-campaign-${c.id}`}
                >
                  <span className="history-summary-main">
                    <span className="history-title">{c.sourceTitle}</span>
                    <span className="history-meta">
                      <span>{fmt(c.updatedAt)}</span>
                      <span>{c.platforms.map((p) => platformNames[p] ?? p).join(", ")}</span>
                    </span>
                  </span>
                  <ChevronDown size={18} className="history-chevron" aria-hidden="true" />
                </button>
                {opened.includes(c.id) && (
                  <div id={`history-detail-${c.id}`} hidden={!open}>{card(c)}</div>
                )}
              </li>
            );
          })}
        </ul>
        {opened.filter((id) => !pageIds.has(id)).map((id) => {
          const c = campaigns.find((x) => x.id === id);
          return c ? <div key={id} hidden>{card(c)}</div> : null;
        })}
        {filtered.length > PAGE_SIZE && (
          <nav className="history-pager" aria-label="Post history pages">
            <span aria-live="polite">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div>
              <button className="button button-small" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} data-testid="button-history-prev"><ChevronLeft size={14} />Previous</button>
              <button className="button button-small" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)} data-testid="button-history-next">Next<ChevronRight size={14} /></button>
            </div>
          </nav>
        )}
      </>
    );
  }

  return (
    <section className="panel content-section" id="campaigns" data-testid="section-campaigns">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Post history</h2>
          {!isLoading && !error && campaigns.length > 0 && (
            <div className="panel-subtitle">{campaigns.length} saved campaigns, newest first</div>
          )}
        </div>
      </div>
      {body}
    </section>
  );
}
