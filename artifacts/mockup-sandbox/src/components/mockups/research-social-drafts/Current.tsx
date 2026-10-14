import "./_group.css";
import { useState } from "react";
import { Check, Clipboard, Clock3, MessageSquareText, Trash2 } from "lucide-react";

type PlatformDraft = {
  platform: string;
  content: string;
  hashtags: string[];
  characterCount: number;
  characterLimit: number;
};

type Campaign = {
  id: number;
  sourceId: number;
  sourceTitle: string;
  provider: "openai" | "anthropic" | "gemini";
  model: string;
  status: "needs_review" | "approved" | "changes_requested";
  tone: string;
  platforms: string[];
  outputs: PlatformDraft[];
  estimatedCostUsd: number;
  createdAt: string;
  updatedAt: string;
};

type CampaignReviewUpdate = {
  status?: Campaign["status"];
  outputs?: PlatformDraft[];
};

type CampaignPanelProps = {
  campaigns: Campaign[];
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;
  onReview: (campaign: Campaign, update: CampaignReviewUpdate) => void;
  onDelete: (campaign: Campaign) => void;
  savingId: number | null;
};

const platformNames: Record<string, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  bluesky: "Bluesky",
  substack: "Substack",
  x: "X",
  instagram: "Instagram",
};

const statusNames: Record<string, string> = {
  needs_review: "Needs review",
  approved: "Approved",
  changes_requested: "Changes requested",
};

function CampaignCard({
  campaign,
  onReview,
  onDelete,
  saving,
}: {
  campaign: Campaign;
  onReview: CampaignPanelProps["onReview"];
  onDelete: CampaignPanelProps["onDelete"];
  saving: boolean;
}) {
  const [drafts, setDrafts] = useState<PlatformDraft[]>(campaign.outputs);
  const [copiedPlatform, setCopiedPlatform] = useState<string | null>(null);
  const [copyErrorPlatform, setCopyErrorPlatform] = useState<string | null>(null);
  const makeStatusUpdate = (status: Campaign["status"]) => {
    onReview(campaign, { status, outputs: drafts });
  };
  const copyDraft = async (draft: PlatformDraft) => {
    const text = [draft.content, draft.hashtags.join(" ")].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPlatform(draft.platform);
      setCopyErrorPlatform(null);
      window.setTimeout(() => {
        setCopiedPlatform((current) => current === draft.platform ? null : current);
      }, 1600);
    } catch {
      setCopyErrorPlatform(draft.platform);
    }
  };
  const updateDraft = (platform: string, content: string) => {
    setDrafts((current) => current.map((draft) => draft.platform === platform
      ? {
          ...draft,
          content,
          characterCount: content.length + (draft.hashtags.length ? draft.hashtags.join(" ").length + 1 : 0),
        }
      : draft));
  };
  const deleteThisCampaign = () => {
    if (window.confirm(`Delete drafts for “${campaign.sourceTitle}”? This cannot be undone.`)) {
      onDelete(campaign);
    }
  };
  const statusClass = campaign.status === "approved"
    ? "status-badge status-approved"
    : campaign.status === "changes_requested"
      ? "status-badge status-changes"
      : "status-badge";

  return (
    <article className="campaign-card" data-testid={`campaign-card-${campaign.id}`}>
      <div className="campaign-topline">
        <div className="campaign-source" data-testid={`campaign-source-${campaign.id}`}>{campaign.sourceTitle}</div>
        <span className={statusClass} data-testid={`campaign-status-${campaign.id}`}>
          {campaign.status === "approved" ? <Check size={10} /> : <Clock3 size={10} />}
          {statusNames[campaign.status] ?? campaign.status}
        </span>
      </div>
      <div className="campaign-meta">
        <span>{campaign.provider}</span>
        <span>·</span>
        <span>{campaign.model}</span>
        <span>·</span>
        <span>{new Date(campaign.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span>·</span>
        <span title="Estimated direct-provider token-price equivalent; actual Replit AI Integration charges are billed in Replit credits.">
          ~${Number(campaign.estimatedCostUsd).toFixed(4)} direct API ref.
        </span>
      </div>
      <div className="draft-stack" aria-label="Platform drafts">
        {drafts.map((draft) => (
          <div className="draft-editor" key={draft.platform}>
          <div className="draft-topline">
              <div className="draft-heading">
                <span className="field-label">{platformNames[draft.platform] ?? draft.platform} draft</span>
                <span
                  className={`draft-char${draft.characterCount > draft.characterLimit ? " over-limit" : ""}`}
                  data-testid={`draft-count-${campaign.id}-${draft.platform}`}
                >
                  {draft.characterCount} / {draft.characterLimit}
                </span>
              </div>
              <button
                className="button button-small draft-copy-button"
                onClick={() => void copyDraft(draft)}
                data-testid={`button-copy-draft-${campaign.id}-${draft.platform}`}
                aria-live="polite"
              >
                {copiedPlatform === draft.platform ? <Check size={12} /> : <Clipboard size={12} />}
                {copiedPlatform === draft.platform
                  ? "Copied"
                  : copyErrorPlatform === draft.platform
                    ? "Copy failed"
                    : `Copy ${platformNames[draft.platform] ?? draft.platform}`}
              </button>
          </div>
          <textarea
            className="textarea draft-copy"
            value={draft.content}
            onChange={(event) => updateDraft(draft.platform, event.target.value)}
            aria-label={`${platformNames[draft.platform] ?? draft.platform} draft copy`}
            data-testid={`textarea-draft-${campaign.id}-${draft.platform}`}
          />
          {draft.hashtags.length > 0 && (
            <div className="hashtag-row" data-testid={`hashtags-${campaign.id}-${draft.platform}`}>
              {draft.hashtags.map((tag) => (
                <span className="hashtag" key={tag}>{tag.startsWith("#") ? tag : `#${tag}`}</span>
              ))}
            </div>
          )}
            {copyErrorPlatform === draft.platform && <div className="copy-error" role="status">Could not copy. Try selecting and copying the text.</div>}
          </div>
        ))}
      </div>
      <div className="campaign-actions">
        <div className="campaign-actions-left">
          <button
            className="button button-small"
            onClick={() => onReview(campaign, { outputs: drafts })}
            disabled={saving}
            data-testid={`button-save-draft-${campaign.id}`}
          >
            <Check size={12} />
            Save edits
          </button>
          <button
            className="button button-small button-quiet button-danger"
            onClick={deleteThisCampaign}
            data-testid={`button-delete-campaign-${campaign.id}`}
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
        <div className="campaign-actions-right">
          <button
            className="button button-small"
            onClick={() => makeStatusUpdate("changes_requested")}
            disabled={saving}
            data-testid={`button-request-changes-${campaign.id}`}
          >
            <MessageSquareText size={12} />
            Request changes
          </button>
          <button
            className="button button-small button-primary"
            onClick={() => makeStatusUpdate("approved")}
            disabled={saving || campaign.status === "approved"}
            data-testid={`button-approve-campaign-${campaign.id}`}
          >
            <Check size={12} />
            {campaign.status === "approved" ? "Approved" : "Approve"}
          </button>
        </div>
      </div>
      <div className="campaign-footnote" style={{ marginTop: 9 }}>
        Drafts only. Nothing is posted from this desk.
      </div>
    </article>
  );
}

export function CampaignPanel({
  campaigns,
  isLoading,
  error,
  onRetry,
  onReview,
  onDelete,
  savingId,
}: CampaignPanelProps) {
  return (
    <section className="panel content-section" id="campaigns" data-testid="section-campaigns">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Campaign drafts</h2>
          <div className="panel-subtitle">Copy any platform draft directly, then review the full set.</div>
        </div>
        <span className="eyebrow">{campaigns.length} total</span>
      </div>
      {isLoading ? (
        <div className="loading-state" data-testid="loading-campaigns">
          <div className="skeleton" style={{ width: "86%", margin: "0 auto 10px" }} />
          <div className="skeleton" style={{ width: "60%", margin: "0 auto" }} />
        </div>
      ) : error ? (
        <div className="error-state" data-testid="error-campaigns">
          Campaign drafts could not be loaded.
          <div style={{ marginTop: 10 }}>
            <button className="button button-small" onClick={onRetry} data-testid="button-retry-campaigns">
              Retry
            </button>
          </div>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="empty-state" data-testid="empty-campaigns">
          <div className="empty-icon">
            <MessageSquareText size={16} />
          </div>
          <strong>The review queue is clear</strong>
          <div style={{ marginTop: 5 }}>Choose a source and generate your first set of platform drafts.</div>
        </div>
      ) : (
        <div className="campaign-list">
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              onReview={onReview}
              onDelete={onDelete}
              saving={savingId === campaign.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const exampleCampaign: Campaign = {
  id: 7,
  sourceId: 2,
  sourceTitle: "How neighborhood design affects access to primary care",
  provider: "openai",
  model: "gpt-6-luna",
  status: "needs_review",
  tone: "Clear, curious, evidence-led",
  platforms: ["linkedin", "bluesky", "substack"],
  outputs: [
    {
      platform: "linkedin",
      content: "Our latest primer looks at how neighborhood design can shape access to primary care—and where better data can help communities make more informed choices.",
      hashtags: ["#PublicHealth", "#EvidenceInPractice"],
      characterCount: 194,
      characterLimit: 3000,
    },
    {
      platform: "bluesky",
      content: "How does neighborhood design affect access to primary care? Our new primer reviews what the evidence can—and can't—tell us.",
      hashtags: ["#PublicHealth", "#Research"],
      characterCount: 151,
      characterLimit: 300,
    },
    {
      platform: "substack",
      content: "A closer look at the relationship between neighborhood design and access to primary care, with evidence, caveats, and questions for future research.",
      hashtags: ["#Research", "#HealthEquity"],
      characterCount: 175,
      characterLimit: 10000,
    },
  ],
  estimatedCostUsd: 0.0008,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function Current() {
  return (
    <main className="mockup-current">
      <div className="mockup-current-label">Current workflow · platform drafts</div>
      <CampaignPanel
        campaigns={[exampleCampaign]}
        isLoading={false}
        error={false}
        onRetry={() => {}}
        onReview={() => {}}
        onDelete={() => {}}
        savingId={null}
      />
    </main>
  );
}
