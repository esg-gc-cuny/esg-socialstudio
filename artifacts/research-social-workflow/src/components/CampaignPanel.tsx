import { useState } from "react";
import { Check, Clipboard } from "lucide-react";
import type { Campaign, CampaignReviewUpdate, PlatformDraft } from "@workspace/api-client-react";

type CampaignPanelProps = {
  campaigns: Campaign[];
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;
  onReview: (campaign: Campaign, update: CampaignReviewUpdate) => void;
  savingId: number | null;
  title?: string;
  emptyMessage?: string;
  emptyHint?: string;
};

const providerNames: Record<string, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
};

const excludedHashtags = new Set(["#researchcommunication", "#evidenceinpractice"]);

function cleanDraft(draft: PlatformDraft): PlatformDraft {
  const hashtags = draft.hashtags
    .map((tag) => tag.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D\u20E3]/gu, ""))
    .filter((tag) => tag.length > 1 && !excludedHashtags.has(tag.toLowerCase()));
  const content = draft.content
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D\u20E3]/gu, "")
    .replace(/\s*--+\s*/g, ", ")
    .replace(/\s*[\u2012-\u2015]\s*/g, ", ")
    .replace(/#ResearchCommunication\b|#EvidenceInPractice\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return {
    ...draft,
    content,
    hashtags,
    characterCount: getCopiedPostText(content, hashtags).length,
  };
}

const platformNames: Record<string, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  bluesky: "Bluesky",
  substack: "Substack Note",
  x: "X",
  instagram: "Instagram",
};

function splitArticleLink(content: string): { body: string; url: string } {
  const match = content.match(
    /(?:^|\n)[ \t]*(?:Read the full article on our website:|Full article:|The full article is available at)[ \t]*(https?:\/\/\S+)[ \t]*(?=\n|$)/im,
  );
  if (!match) return { body: content.trim(), url: "" };

  const body = content
    .replace(
      /(?:^|\n)[ \t]*(?:Read the full article on our website:|Full article:|The full article is available at)[ \t]*https?:\/\/\S+[ \t]*(?=\n|$)/im,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, url: match[1] };
}

function getCopiedPostText(content: string, hashtags: string[]): string {
  const { body, url } = splitArticleLink(content);
  return [
    body,
    hashtags.join(" "),
    url ? `Read the full article on our website: ${url}` : "",
  ].filter(Boolean).join("\n\n");
}

function parsePostText(text: string): { content: string; hashtags: string[] } {
  const { body, url } = splitArticleLink(text);
  const hashtags = Array.from(body.matchAll(/(^|\s)(#[\p{L}\p{N}_-]+)/gu))
    .map((match) => match[2])
    .filter(Boolean);
  const bodyWithoutHashtags = body
    .replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const cta = url ? `Read the full article on our website: ${url}` : "";
  return {
    content: [bodyWithoutHashtags, cta].filter(Boolean).join("\n\n"),
    hashtags,
  };
}

function CampaignCard({
  campaign,
  onReview,
  saving,
  initialDrafts,
  onDraftsChange,
}: {
  campaign: Campaign;
  onReview: CampaignPanelProps["onReview"];
  saving: boolean;
  initialDrafts?: PlatformDraft[];
  onDraftsChange?: (drafts: PlatformDraft[]) => void;
}) {
  const [drafts, setDrafts] = useState<PlatformDraft[]>(() => initialDrafts ?? campaign.outputs.map(cleanDraft));
  const [copiedPlatform, setCopiedPlatform] = useState<string | null>(null);
  const [copyErrorPlatform, setCopyErrorPlatform] = useState<string | null>(null);
  const copyDraft = async (draft: PlatformDraft) => {
    const text = getCopiedPostText(draft.content, draft.hashtags);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPlatform(draft.platform);
      setCopyErrorPlatform(null);
      window.setTimeout(() => {
        setCopiedPlatform((current) => current === draft.platform ? null : current);
      }, 1600);
    } catch {
      setCopyErrorPlatform(draft.platform);
      window.setTimeout(() => setCopyErrorPlatform((current) => current === draft.platform ? null : current), 2500);
    }
  };
  const updateDraft = (platform: string, postText: string) => {
    const parsed = parsePostText(postText);
    const next = drafts.map((draft) => draft.platform === platform
      ? {
          ...draft,
          content: parsed.content,
          hashtags: parsed.hashtags,
          characterCount: getCopiedPostText(parsed.content, parsed.hashtags).length,
        }
      : draft);
    setDrafts(next);
    onDraftsChange?.(next);
  };
  return (
    <article className="campaign-card" data-testid={`campaign-card-${campaign.id}`}>
      <div className="campaign-topline">
        <div className="campaign-source" data-testid={`campaign-source-${campaign.id}`}>{campaign.sourceTitle}</div>
        <span className="campaign-provider-label">{providerNames[campaign.provider] ?? campaign.provider}</span>
      </div>
      <div className="draft-stack" aria-label="Platform drafts">
        {drafts.map((draft) => {
          const postText = getCopiedPostText(draft.content, draft.hashtags);
          return (
          <div className="draft-editor" key={draft.platform}>
          <div className="draft-topline">
              <div className="draft-heading">
                <span className="field-label">{platformNames[draft.platform] ?? draft.platform} draft</span>
                <span
                  className={`draft-char${draft.characterCount > draft.characterLimit ? " over-limit" : ""}`}
                  data-testid={`draft-count-${campaign.id}-${draft.platform}`}
                  aria-label={`${draft.characterCount} characters, recommended target ${draft.characterLimit}`}
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
            value={postText}
            ref={(element) => {
              if (!element) return;
              element.style.height = "auto";
              element.style.height = `${element.scrollHeight}px`;
            }}
            onChange={(event) => updateDraft(draft.platform, event.target.value)}
            aria-label={`${platformNames[draft.platform] ?? draft.platform} draft copy`}
            data-testid={`textarea-draft-${campaign.id}-${draft.platform}`}
          />
          {copyErrorPlatform === draft.platform && (
            <div className="copy-error" role="status">Could not copy. Try selecting and copying the text.</div>
          )}
          </div>
          );
        })}
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
        </div>
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
  savingId,
  title = "Posts",
  emptyMessage,
  emptyHint,
}: CampaignPanelProps) {
  const resolvedEmptyMessage = emptyMessage ?? (title === "Previous posts" ? "No previous posts" : "No posts yet");
  const resolvedEmptyHint = emptyHint ?? (title === "Posts" ? "Paste text or add a link above." : "");
  return (
    <section className="panel content-section" id="campaigns" data-testid="section-campaigns">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{title}</h2>
        </div>
      </div>
      {isLoading ? (
        <div className="loading-state" data-testid="loading-campaigns">
          <div className="skeleton" style={{ width: "86%", margin: "0 auto 10px" }} />
          <div className="skeleton" style={{ width: "60%", margin: "0 auto" }} />
        </div>
      ) : error ? (
        <div className="error-state" data-testid="error-campaigns">
          Posts could not be loaded.
          <div style={{ marginTop: 10 }}>
            <button className="button button-small" onClick={onRetry} data-testid="button-retry-campaigns">
              Retry
            </button>
          </div>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="empty-state" data-testid="empty-campaigns">
          <strong>{resolvedEmptyMessage}</strong>
          {resolvedEmptyHint && <div style={{ marginTop: 5 }}>{resolvedEmptyHint}</div>}
        </div>
      ) : (
        <div className="campaign-list">
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              onReview={onReview}
              saving={savingId === campaign.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}
