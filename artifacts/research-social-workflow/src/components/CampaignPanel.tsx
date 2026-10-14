import { useState } from "react";
import { Check, Clipboard, Clock3, MessageSquareText, Trash2 } from "lucide-react";
import type { Campaign, CampaignReviewUpdate, PlatformDraft } from "@workspace/api-client-react";

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
  const [activePlatform, setActivePlatform] = useState(campaign.outputs[0]?.platform ?? "");
  const [copied, setCopied] = useState(false);
  const activeDraft = drafts.find((draft) => draft.platform === activePlatform);
  const makeStatusUpdate = (status: Campaign["status"]) => {
    onReview(campaign, { status, outputs: drafts });
  };
  const copyDraft = async () => {
    if (!activeDraft) {
      return;
    }
    const text = [activeDraft.content, activeDraft.hashtags.join(" ")].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  const updateDraft = (content: string) => {
    setDrafts((current) => current.map((draft) => draft.platform === activePlatform
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
      <div className="platform-tabs" role="tablist" aria-label="Platform drafts">
        {campaign.outputs.map((draft) => (
          <button
            key={draft.platform}
            role="tab"
            aria-selected={activePlatform === draft.platform}
            className={`platform-tab${activePlatform === draft.platform ? " active" : ""}`}
            onClick={() => setActivePlatform(draft.platform)}
            data-testid={`tab-platform-${campaign.id}-${draft.platform}`}
          >
            {platformNames[draft.platform] ?? draft.platform}
          </button>
        ))}
      </div>
      {activeDraft && (
        <div className="draft-editor">
          <div className="draft-topline">
            <span className="field-label">{platformNames[activeDraft.platform] ?? activeDraft.platform} draft</span>
            <span
              className={`draft-char${activeDraft.characterCount > activeDraft.characterLimit ? " over-limit" : ""}`}
              data-testid={`draft-count-${campaign.id}-${activeDraft.platform}`}
            >
              {activeDraft.characterCount} / {activeDraft.characterLimit}
            </span>
          </div>
          <textarea
            className="textarea draft-copy"
            value={activeDraft.content}
            onChange={(event) => updateDraft(event.target.value)}
            aria-label={`${platformNames[activeDraft.platform] ?? activeDraft.platform} draft copy`}
            data-testid={`textarea-draft-${campaign.id}-${activeDraft.platform}`}
          />
          {activeDraft.hashtags.length > 0 && (
            <div className="hashtag-row" data-testid={`hashtags-${campaign.id}-${activeDraft.platform}`}>
              {activeDraft.hashtags.map((tag) => (
                <span className="hashtag" key={tag}>{tag.startsWith("#") ? tag : `#${tag}`}</span>
              ))}
            </div>
          )}
        </div>
      )}
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
            className="button button-small"
            onClick={copyDraft}
            disabled={!activeDraft}
            data-testid={`button-copy-draft-${campaign.id}`}
          >
            {copied ? <Check size={12} /> : <Clipboard size={12} />}
            {copied ? "Copied" : "Copy draft"}
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
          <div className="panel-subtitle">Review each platform before anything leaves the desk.</div>
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
