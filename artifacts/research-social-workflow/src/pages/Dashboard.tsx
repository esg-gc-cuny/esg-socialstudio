import { useState } from "react";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  Layers3,
  LoaderCircle,
  MessageSquareText,
  PenLine,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  getGetDashboardQueryKey,
  getListCampaignsQueryKey,
  getListProvidersQueryKey,
  getListSourcesQueryKey,
  useCreateSource,
  useDeleteCampaign,
  useDeleteSource,
  useGenerateCampaign,
  useGetDashboard,
  useListCampaigns,
  useListProviders,
  useListSources,
  useReviewCampaign,
  useUpdateSource,
} from "@workspace/api-client-react";
import type {
  Campaign,
  CampaignGenerationInput,
  CampaignReviewUpdate,
  ContentSource,
  ProviderInfo,
  SourceInput,
  SourceUpdate,
} from "@workspace/api-client-react";
import { CampaignPanel } from "../components/CampaignPanel";
import { ProviderPanel } from "../components/ProviderPanel";
import { SourcePanel } from "../components/SourcePanel";

const platforms = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "facebook", label: "Facebook" },
  { id: "bluesky", label: "Bluesky" },
  { id: "substack", label: "Substack" },
  { id: "x", label: "X" },
  { id: "instagram", label: "Instagram" },
] as const;

const providerLabels: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Claude",
  gemini: "Gemini",
};

function Metric({
  label,
  value,
  foot,
  testId,
}: {
  label: string;
  value: number;
  foot: string;
  testId: string;
}) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" data-testid={testId}>{value}</div>
      <div className="metric-foot">{foot}</div>
    </div>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const dashboardQuery = useGetDashboard();
  const sourcesQuery = useListSources();
  const campaignsQuery = useListCampaigns();
  const providersQuery = useListProviders();
  const createSource = useCreateSource();
  const updateSource = useUpdateSource();
  const deleteSource = useDeleteSource();
  const generateCampaign = useGenerateCampaign();
  const reviewCampaign = useReviewCampaign();
  const deleteCampaign = useDeleteCampaign();

  const [selectedSource, setSelectedSource] = useState("");
  const [provider, setProvider] = useState("openai");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["linkedin", "bluesky", "x"]);
  const [tone, setTone] = useState("Clear, curious, and grounded in evidence");
  const [audience, setAudience] = useState("");
  const [campaignGoal, setCampaignGoal] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewSavingId, setReviewSavingId] = useState<number | null>(null);

  const sources = sourcesQuery.data ?? [];
  const campaigns = campaignsQuery.data ?? [];
  const providers = providersQuery.data ?? [];
  const supportedProviders = providers.filter((item: ProviderInfo) => item.id !== "copilot");
  const summary = dashboardQuery.data;
  const pendingReviews = summary?.needsReviewCount ?? campaigns.filter((item) => item.status === "needs_review").length;
  const approvedCount = summary?.approvedCount ?? campaigns.filter((item) => item.status === "approved").length;
  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  };

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
  };

  const handleSaveSource = (payload: SourceInput | SourceUpdate, id?: number) => {
    if (id !== undefined) {
      updateSource.mutate(
        { id, data: payload as SourceUpdate },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey() });
            void queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
            notify("Source changes saved.");
          },
          onError: () => notify("Source could not be saved. Try again."),
        },
      );
      return;
    }
    createSource.mutate(
      { data: payload as SourceInput },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          notify("Source saved to the library.");
        },
        onError: () => notify("Source could not be saved. Try again."),
      },
    );
  };

  const handleDeleteSource = (source: ContentSource) => {
    if (!window.confirm(`Delete “${source.title}” and its associated campaigns? This cannot be undone.`)) {
      return;
    }
    deleteSource.mutate(
      { id: source.id },
      {
        onSuccess: () => {
          refreshAll();
          notify("Source and associated campaigns deleted.");
        },
        onError: () => notify("Source could not be deleted. Try again."),
      },
    );
  };

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((current) => current.includes(id)
      ? current.filter((platform) => platform !== id)
      : [...current, id]);
  };

  const handleGenerate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSource || selectedPlatforms.length === 0) {
      notify("Choose a source and at least one platform.");
      return;
    }
    const payload: CampaignGenerationInput = {
      sourceId: Number(selectedSource),
      provider: provider as CampaignGenerationInput["provider"],
      platforms: selectedPlatforms as CampaignGenerationInput["platforms"],
      tone: tone.trim(),
      audience: audience.trim() || undefined,
      campaignGoal: campaignGoal.trim() || undefined,
    };
    generateCampaign.mutate(
      { data: payload },
      {
        onSuccess: () => {
          refreshAll();
          notify("Platform drafts generated. Ready for review.");
        },
        onError: () => notify("Draft generation failed. Check provider access and try again."),
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
          notify(update.status === "approved" ? "Campaign approved." : update.status === "changes_requested" ? "Changes requested." : "Draft edits saved.");
          setReviewSavingId(null);
        },
        onError: () => {
          notify("Campaign update failed. Your current edits remain on screen.");
          setReviewSavingId(null);
        },
      },
    );
  };

  const handleDeleteCampaign = (campaign: Campaign) => {
    deleteCampaign.mutate(
      { id: campaign.id },
      {
        onSuccess: () => {
          refreshAll();
          notify("Campaign drafts deleted.");
        },
        onError: () => notify("Campaign could not be deleted. Try again."),
      },
    );
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <PenLine size={17} />
          </div>
          <div>
            <div className="brand-name">Research Desk</div>
            <div className="brand-caption">Social workflow</div>
          </div>
        </div>
        <div className="rail-label">Workspace</div>
        <button className="rail-link is-current" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} data-testid="nav-dashboard">
          <Layers3 size={15} />
          <span>Workflow overview</span>
        </button>
        <button className="rail-link" onClick={() => scrollTo("sources")} data-testid="nav-sources">
          <BookOpen size={15} />
          <span>Source library</span>
          <span className="rail-count">{sources.length}</span>
        </button>
        <button className="rail-link" onClick={() => scrollTo("campaigns")} data-testid="nav-campaigns">
          <MessageSquareText size={15} />
          <span>Campaign drafts</span>
          <span className="rail-count">{pendingReviews}</span>
        </button>
        <div className="rail-label">Reference</div>
        <button className="rail-link" onClick={() => scrollTo("providers")} data-testid="nav-providers">
          <CircleHelp size={15} />
          <span>Provider access</span>
        </button>
        <div className="rail-spacer" />
        <div className="rail-note">
          <div className="rail-note-title">
            <Check size={12} />
            Review before sharing
          </div>
          <p>Every campaign stays a draft here. Approved copy still needs to be posted by your team.</p>
        </div>
        <div className="rail-footer">RESEARCH COMMUNICATIONS · 01</div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            Research group
            <ChevronRight size={13} />
            <strong>Editorial desk</strong>
          </div>
          <div className="topbar-meta">
            <span><i className="live-indicator" />Workspace ready</span>
            <span>•</span>
            <span>Local time {new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
          </div>
        </header>

        {dashboardQuery.isError && (
          <div className="error-state" style={{ padding: "10px 0", textAlign: "left" }} data-testid="error-dashboard">
            Workflow summary could not be refreshed.
            <button
              className="button button-small"
              style={{ marginLeft: 10 }}
              onClick={() => void dashboardQuery.refetch()}
              data-testid="button-retry-dashboard"
            >
              Retry summary
            </button>
          </div>
        )}

        <section className="page-heading">
          <div>
            <div className="eyebrow">Research communications / Workflow 01</div>
            <h1>The editorial desk</h1>
            <p>Turn trusted source material into platform-ready drafts. Review every line before it travels.</p>
          </div>
          <button className="button" onClick={() => scrollTo("sources")} data-testid="button-browse-sources">
            <FileText size={14} />
            Browse sources
          </button>
        </section>

        <div className="workflow-note" data-testid="notice-access-control">
          <CircleHelp size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          This MVP has no sign-in or access controls. Only use material cleared for this workspace; add authentication before storing confidential or unpublished research.
        </div>

        <div className="metric-grid" data-testid="dashboard-summary">
          <Metric label="Saved sources" value={summary?.sourceCount ?? sources.length} foot="House articles & primers" testId="metric-sources" />
          <Metric label="Campaigns" value={summary?.campaignCount ?? campaigns.length} foot="Draft sets generated" testId="metric-campaigns" />
          <Metric label="Needs review" value={pendingReviews} foot="Awaiting editorial pass" testId="metric-needs-review" />
          <Metric label="Approved" value={approvedCount} foot="Ready for team handoff" testId="metric-approved" />
        </div>

        <div className="desk-grid">
          <section className="panel" data-testid="panel-create-campaign">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Build a draft set</h2>
                <div className="panel-subtitle">One source, tailored to the channels you select.</div>
              </div>
              <span className="eyebrow">01 / Compose</span>
            </div>
            <form className="panel-body source-form" onSubmit={handleGenerate}>
              <div className="field">
                <label htmlFor="campaign-source">Research source</label>
                <select
                  id="campaign-source"
                  className="select"
                  value={selectedSource}
                  onChange={(event) => setSelectedSource(event.target.value)}
                  disabled={sources.length === 0}
                  required
                  data-testid="select-campaign-source"
                >
                  <option value="">Select saved material</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>{source.title}</option>
                  ))}
                </select>
                {sources.length === 0 && !sourcesQuery.isLoading && (
                  <span className="form-hint">Save a source below before generating drafts.</span>
                )}
              </div>
              <div className="field">
                <label>Destination platforms</label>
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
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="provider-select">Writing model</label>
                  <select
                    id="provider-select"
                    className="select"
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                    data-testid="select-provider"
                  >
                    {(supportedProviders.length ? supportedProviders : [
                      { id: "openai", name: "OpenAI" },
                      { id: "anthropic", name: "Claude" },
                      { id: "gemini", name: "Gemini" },
                    ]).map((item) => (
                      <option key={item.id} value={item.id}>{providerLabels[item.id] ?? item.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="tone-input">Editorial tone</label>
                  <input
                    id="tone-input"
                    className="input"
                    value={tone}
                    onChange={(event) => setTone(event.target.value)}
                    maxLength={120}
                    required
                    data-testid="input-campaign-tone"
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="audience-input">Audience <span>(optional)</span></label>
                  <input
                    id="audience-input"
                    className="input"
                    value={audience}
                    onChange={(event) => setAudience(event.target.value)}
                    maxLength={200}
                    placeholder="e.g. Policy researchers"
                    data-testid="input-campaign-audience"
                  />
                </div>
                <div className="field">
                  <label htmlFor="goal-input">Campaign goal <span>(optional)</span></label>
                  <input
                    id="goal-input"
                    className="input"
                    value={campaignGoal}
                    onChange={(event) => setCampaignGoal(event.target.value)}
                    maxLength={200}
                    placeholder="e.g. Invite seminar sign-ups"
                    data-testid="input-campaign-goal"
                  />
                </div>
              </div>
              <hr className="section-break" />
              <div className="workflow-note">
                <Sparkles size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                This creates editable drafts only. Nothing is scheduled, published, or posted.
              </div>
              <div className="form-actions">
                <span className="form-hint">{selectedPlatforms.length} {selectedPlatforms.length === 1 ? "platform" : "platforms"} selected</span>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={generateCampaign.isPending || !selectedSource || selectedPlatforms.length === 0 || sourcesQuery.isLoading}
                  data-testid="button-generate-campaign"
                >
                  {generateCampaign.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {generateCampaign.isPending ? "Generating drafts…" : "Generate drafts"}
                </button>
              </div>
            </form>
          </section>

          <CampaignPanel
            campaigns={campaigns}
            isLoading={campaignsQuery.isLoading}
            error={campaignsQuery.isError}
            onRetry={() => void campaignsQuery.refetch()}
            onReview={handleReview}
            onDelete={handleDeleteCampaign}
            savingId={reviewSavingId}
          />
        </div>

        <div className="lower-grid">
          <SourcePanel
            sources={sources}
            isLoading={sourcesQuery.isLoading}
            error={sourcesQuery.isError}
            saving={createSource.isPending || updateSource.isPending}
            onRetry={() => void sourcesQuery.refetch()}
            onSave={handleSaveSource}
            onDelete={handleDeleteSource}
          />
          <ProviderPanel
            providers={providers}
            isLoading={providersQuery.isLoading}
            error={providersQuery.isError}
            onRetry={() => void providersQuery.refetch()}
          />
        </div>
        <div className="topbar-meta" style={{ justifyContent: "space-between", paddingTop: 20 }}>
          <span>Editorial workflow · Sources remain attributed to their original publisher.</span>
          <button className="button button-quiet button-small" onClick={refreshAll} data-testid="button-refresh-workspace">
            <RefreshCw size={12} />
            Refresh data
          </button>
        </div>
      </main>
      {notice && <div className="toast-message" role="status" data-testid="status-notice">{notice}</div>}
    </div>
  );
}

export default Dashboard;
