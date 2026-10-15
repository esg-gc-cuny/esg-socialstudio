import { useState } from "react";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import {
  getListCampaignsQueryKey,
  getListSourcesQueryKey,
  useCreateSource,
  useExtractArticle,
  useGenerateCampaign,
  useListCampaigns,
  useListSources,
  useReviewCampaign,
} from "@workspace/api-client-react";
import type {
  Campaign,
  CampaignGenerationInput,
  CampaignReviewUpdate,
  SourceInput,
} from "@workspace/api-client-react";
import { CampaignPanel } from "../components/CampaignPanel";

const platforms = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "facebook", label: "Facebook" },
  { id: "bluesky", label: "Bluesky" },
  { id: "substack", label: "Substack Note" },
] as const;

function Dashboard() {
  const queryClient = useQueryClient();
  const sourcesQuery = useListSources();
  const campaignsQuery = useListCampaigns();
  const createSource = useCreateSource();
  const extractArticle = useExtractArticle();
  const generateCampaign = useGenerateCampaign();
  const reviewCampaign = useReviewCampaign();

  const [inputMode, setInputMode] = useState<"paste" | "link">("paste");
  const [sourceContent, setSourceContent] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["linkedin", "facebook", "bluesky", "substack"]);
  const [generateHashtags, setGenerateHashtags] = useState(true);
  const [postsCleared, setPostsCleared] = useState(false);
  const [activeCampaignId, setActiveCampaignId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [reviewSavingId, setReviewSavingId] = useState<number | null>(null);

  const sources = sourcesQuery.data ?? [];
  const campaigns = [...(campaignsQuery.data ?? [])].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const latestCampaign =
    campaigns.find((campaign) => campaign.id === activeCampaignId) ?? campaigns[0];
  const isGenerating = createSource.isPending || extractArticle.isPending || generateCampaign.isPending;

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  };

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
  };

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((current) => current.includes(id)
      ? current.filter((platform) => platform !== id)
      : [...current, id]);
  };

  const resetPosts = () => {
    setPostsCleared(true);
    notify("Posts cleared from view. Saved campaigns are unchanged.");
  };

  const scrollToResults = () => {
    document.getElementById("generated-drafts")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const generateForSource = (
    sourceId: number,
    selected: string[],
    shouldGenerateHashtags: boolean,
  ) => {
    generateCampaign.mutate(
      {
        data: {
          sourceId,
          provider: "anthropic",
          platforms: selected as CampaignGenerationInput["platforms"],
          tone: "Match the article's voice; write a concise teaser that invites readers to continue",
          generateHashtags: shouldGenerateHashtags,
        },
      },
      {
        onSuccess: (campaign) => {
          refreshAll();
          setPostsCleared(false);
          setActiveCampaignId(campaign.id);
          notify("Claude posts are ready to copy.");
          window.setTimeout(scrollToResults, 80);
        },
        onError: () => {
          refreshAll();
          notify("The article was saved, but Claude could not generate posts. Try again.");
        },
      },
    );
  };

  const saveAndGenerate = (
    rawTitle: string,
    rawContent: string,
    selected: string[],
    shouldGenerateHashtags: boolean,
    sourceUrl?: string,
  ) => {
    const content = rawContent.trim();
    if (content.length < 20) {
      notify("Not enough article text was found. Paste the text instead.");
      return;
    }

    const title = rawTitle.trim()
      || content.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 180)
      || "Research article";
    const savedSource = sourceUrl
      ? sources.find((source) => source.sourceUrl === sourceUrl && source.content === content)
      : sources.find((source) => !source.sourceUrl && source.title === title && source.content === content);
    if (savedSource) {
      generateForSource(savedSource.id, selected, shouldGenerateHashtags);
      return;
    }

    createSource.mutate(
      { data: { title, content, ...(sourceUrl ? { sourceUrl } : {}) } },
      {
        onSuccess: (source) => {
          void queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey() });
          generateForSource(source.id, selected, shouldGenerateHashtags);
        },
        onError: () => notify("The article could not be saved. Please try again."),
      },
    );
  };

  const handleGenerate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedPlatforms.length === 0) {
      notify("Choose at least one platform.");
      return;
    }

    const selected = [...selectedPlatforms];
    const shouldGenerateHashtags = generateHashtags;
    if (inputMode === "paste") {
      saveAndGenerate("", sourceContent, selected, shouldGenerateHashtags);
      return;
    }

    extractArticle.mutate(
      { data: { url: articleUrl.trim() } },
      {
        onSuccess: (article) => {
          saveAndGenerate(
            article.title,
            article.content,
            selected,
            shouldGenerateHashtags,
            article.url,
          );
        },
        onError: () => notify("Could not read that link. Try a public page or paste the text instead."),
      },
    );
  };

  const handleReview = (campaign: Campaign, update: CampaignReviewUpdate) => {
    setReviewSavingId(campaign.id);
    reviewCampaign.mutate(
      { id: campaign.id, data: update },
      {
        onSuccess: () => {
          refreshAll();
          notify("Draft edits saved.");
          setReviewSavingId(null);
        },
        onError: () => {
          notify("Draft edits could not be saved. Your current edits remain on screen.");
          setReviewSavingId(null);
        },
      },
    );
  };

  return (
    <div className="simple-tool-shell">
      <main className="simple-tool-main">
        <header className="simple-tool-header">
          <div>
            <h1>ESG Social Studio</h1>
            <ol className="workflow-instructions" aria-label="How to create social drafts">
              <li>Add article text or a public link</li>
              <li>Choose platforms</li>
              <li>Review and copy the drafts</li>
            </ol>
          </div>
        </header>

        <div className="studio-view">
        <section className="panel simple-generator" data-testid="panel-simple-generator">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">New posts</h2>
            </div>
            <span className="model-label">Claude</span>
          </div>
          <form className="panel-body source-form" onSubmit={handleGenerate}>
            <div className="article-mode-toggle" role="group" aria-label="Article input method">
              <button
                type="button"
                className={`article-mode-button ${inputMode === "paste" ? "is-active" : ""}`}
                aria-pressed={inputMode === "paste"}
                onClick={() => setInputMode("paste")}
                data-testid="button-input-paste"
              >
                Paste text
              </button>
              <button
                type="button"
                className={`article-mode-button ${inputMode === "link" ? "is-active" : ""}`}
                aria-pressed={inputMode === "link"}
                onClick={() => setInputMode("link")}
                data-testid="button-input-link"
              >
                Article link
              </button>
            </div>
            {inputMode === "paste" ? (
              <div className="field">
                <label htmlFor="source-content-input">Article or primer</label>
                <textarea
                  id="source-content-input"
                  className="textarea source-content simple-source-content"
                  value={sourceContent}
                  onChange={(event) => setSourceContent(event.target.value)}
                  maxLength={100000}
                  minLength={20}
                  required
                  placeholder="Paste article text…"
                  data-testid="textarea-source-content"
                />
              </div>
            ) : (
              <div className="field">
                <label htmlFor="article-url-input">Public article link</label>
                <input
                  id="article-url-input"
                  className="input article-url-input"
                  type="url"
                  value={articleUrl}
                  onChange={(event) => setArticleUrl(event.target.value)}
                  maxLength={2048}
                  required
                  placeholder="https://example.org/article"
                  data-testid="input-article-url"
                />
              </div>
            )}
            <label className="hashtag-toggle" htmlFor="generate-hashtags">
              <input
                id="generate-hashtags"
                type="checkbox"
                checked={generateHashtags}
                onChange={(event) => setGenerateHashtags(event.target.checked)}
                data-testid="checkbox-generate-hashtags"
              />
              <span>Generate relevant hashtags</span>
              <small>Include all that fit each platform</small>
            </label>
            <div className="platform-picker-heading">
              <label>Platforms</label>
            </div>
            <div className="platform-picker">
              {platforms.map((platform) => (
                <label className="platform-option" key={platform.id}>
                  <input
                    type="checkbox"
                    checked={selectedPlatforms.includes(platform.id)}
                    onChange={() => togglePlatform(platform.id)}
                    data-testid={`checkbox-platform-${platform.id}`}
                  />
                  <span>{platform.label}</span>
                </label>
              ))}
            </div>
            <div className="quick-form-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={resetPosts}
                disabled={isGenerating}
                data-testid="button-reset-posts"
              >
                Reset posts
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={isGenerating || selectedPlatforms.length === 0 || (inputMode === "paste" && sourceContent.trim().length < 20) || (inputMode === "link" && !articleUrl.trim())}
                data-testid="button-generate-campaign"
              >
                {isGenerating && <LoaderCircle size={14} className="animate-spin" />}
                {isGenerating ? "Generating…" : "Generate posts"}
              </button>
            </div>
          </form>
        </section>

        <div id="generated-drafts" className="results-area">
          <CampaignPanel
            campaigns={!postsCleared && latestCampaign ? [latestCampaign] : []}
            isLoading={campaignsQuery.isLoading}
            error={campaignsQuery.isError}
            onRetry={() => void campaignsQuery.refetch()}
            onReview={handleReview}
            savingId={reviewSavingId}
            emptyMessage={postsCleared ? "Posts cleared" : undefined}
            emptyHint={postsCleared ? "Generate posts to create a new set." : undefined}
          />
        </div>
        </div>

        <footer className="simple-tool-footer">Drafts only. Nothing is published or scheduled from this tool.</footer>
      </main>
      {notice && <div className="toast-message" role="status" data-testid="status-notice">{notice}</div>}
    </div>
  );
}

export default Dashboard;
