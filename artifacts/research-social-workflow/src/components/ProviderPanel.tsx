import { ExternalLink, Info, Sparkles } from "lucide-react";
import type { ProviderInfo } from "@workspace/api-client-react";

type ProviderPanelProps = {
  providers: ProviderInfo[];
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;
};

function directPrice(provider: ProviderInfo) {
  if (provider.inputUsdPerMillion == null || provider.outputUsdPerMillion == null) {
    return "Pricing varies";
  }
  return `$${provider.inputUsdPerMillion} in / $${provider.outputUsdPerMillion} out per 1M`;
}

export function ProviderPanel({ providers, isLoading, error, onRetry }: ProviderPanelProps) {
  const callableProviders = providers.filter((provider) => provider.id !== "copilot");
  const copilot = providers.find((provider) => provider.id === "copilot");

  return (
    <section className="panel content-section" id="providers" data-testid="section-providers">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Provider access & cost</h2>
          <div className="panel-subtitle">Know which bill you are looking at.</div>
        </div>
        <Sparkles size={15} color="hsl(var(--primary))" />
      </div>
      <div className="provider-section">
        <p className="provider-intro">
          Model access and cost estimates are separate. Confirm the active billing route with your workspace administrator.
        </p>
        <div className="access-note" data-testid="provider-managed-access">
          <strong>Replit-managed access</strong>
          <br />
          OpenAI, Claude, and Gemini requests run through Replit AI Integrations. No provider API key is needed; usage is billed to Replit credits.
        </div>
        <div className="field-label" style={{ marginBottom: 5 }}>Direct API pricing estimates</div>
        {isLoading ? (
          <div className="loading-state" data-testid="loading-providers">
            <div className="skeleton" style={{ width: "80%", margin: "0 auto 10px" }} />
            <div className="skeleton" style={{ width: "58%", margin: "0 auto" }} />
          </div>
        ) : error ? (
          <div className="error-state" data-testid="error-providers">
            Provider pricing guidance is unavailable.
            <div style={{ marginTop: 10 }}>
              <button className="button button-small" onClick={onRetry} data-testid="button-retry-providers">
                Retry
              </button>
            </div>
          </div>
        ) : (
          <>
            {callableProviders.map((provider) => (
              <article className="provider-item" key={provider.id} data-testid={`provider-${provider.id}`}>
                <div className="provider-item-head">
                  <div>
                    <div className="provider-name" data-testid={`provider-name-${provider.id}`}>{provider.name}</div>
                    <div className="provider-model">{provider.model}</div>
                  </div>
                  <div className="provider-cost" data-testid={`provider-cost-${provider.id}`}>{directPrice(provider)}</div>
                </div>
                <div className="provider-note">{provider.note}</div>
                <div className="provider-model" data-testid={`provider-access-${provider.id}`}>
                  Access route: {provider.apiAccess}
                </div>
                {provider.pricingUrl && (
                  <a
                    className="provider-link"
                    href={provider.pricingUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-testid={`link-pricing-${provider.id}`}
                  >
                    Direct pricing
                    <ExternalLink size={10} />
                  </a>
                )}
              </article>
            ))}
            {copilot && (
              <div className="copilot-note" data-testid="provider-copilot">
                <strong>{copilot.name}</strong>
                {" — "}
                Not callable through a supported direct app API integration. {copilot.note}
                {copilot.pricingUrl && (
                  <a
                    className="provider-link"
                    href={copilot.pricingUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="link-pricing-copilot"
                  >
                    Access guidance
                    <ExternalLink size={10} />
                  </a>
                )}
              </div>
            )}
          </>
        )}
        <div className="provider-note" style={{ display: "flex", gap: 6, alignItems: "start" }}>
          <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          Direct API figures are published rate estimates, not a quote for managed-credit usage. Generated drafts are never automatically published.
        </div>
      </div>
    </section>
  );
}
