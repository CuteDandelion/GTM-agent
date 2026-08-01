import {
  BackpackIcon,
  CalendarIcon,
  CheckCircledIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleIcon,
  Cross2Icon,
  DotFilledIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GlobeIcon,
  HamburgerMenuIcon,
  LightningBoltIcon,
  Link2Icon,
  MixerHorizontalIcon,
  PaperPlaneIcon,
  PersonIcon,
  QuestionMarkCircledIcon,
  ReloadIcon,
  StarIcon,
} from "@radix-ui/react-icons";
import { Bot, Sparkles, Workflow } from "lucide-react";
import { useEffect, useReducer } from "react";

import {
  BottomSheet,
  KeyboardTextarea,
  MobileScroll,
  useKeyboardInsets,
} from "./mobile";
import {
  createInitialConversationState,
  reduceConversationState,
} from "./conversation-state";

const researchSteps = [
  { label: "Plan", agent: "Sol", status: "done" },
  { label: "Research", agent: "Luna", status: "active" },
  { label: "Analyze", agent: "Terra", status: "pending" },
  { label: "Review", agent: "Sol", status: "pending" },
] as const;

const evidenceSources = [
  {
    kind: "web",
    title: "Acme – Homepage",
    url: "https://acme.ai",
    description: "AI platform for customer support automation.",
    classification: "Fact",
    confidence: 4,
    tone: "blue",
  },
  {
    kind: "file",
    title: "Acme – Pricing",
    url: "https://acme.ai/pricing",
    description: "Pricing not publicly listed. Contact sales for details.",
    classification: "Fact",
    confidence: 3,
    tone: "green",
  },
  {
    kind: "file",
    title: "Acme – Blog: Roadmap Update",
    url: "https://acme.ai/blog/roadmap",
    description: "Investing in automation and integrations in 2024.",
    classification: "Inference",
    confidence: 4,
    tone: "violet",
  },
] as const;

export default function Prototype() {
  const [state, dispatch] = useReducer(
    reduceConversationState,
    undefined,
    createInitialConversationState,
  );

  useEffect(() => {
    if (state.screen !== "research_progress") return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "research_completed" });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [state.screen]);

  return (
    <div className="gtm-shell" data-screen={state.screen}>
      <AppHeader />
      <MobileScroll className="app-screen gtm-scroll">
        <main className="conversation" aria-label="GTM research conversation">
          <div className="today-label">Today</div>
          <UserMessage />
          {state.screen === "research_progress" ? (
            <ResearchProgress />
          ) : (
            <CompanyAssessment
              shortlisted={state.shortlisted}
              onEvidence={() => dispatch({ type: "evidence_opened" })}
              onShortlist={() => dispatch({ type: "shortlist_toggled" })}
            />
          )}
        </main>
      </MobileScroll>

      {state.screen !== "evidence_inspection" ? <Composer /> : null}

      <BottomSheet
        open={state.screen === "evidence_inspection"}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "evidence_closed" });
        }}
        title="Evidence"
        description="Key sources and facts supporting this analysis."
        snap={0.96}
      >
        <button
          className="sheet-close"
          type="button"
          aria-label="Close evidence"
          onClick={() => dispatch({ type: "evidence_closed" })}
        >
          <Cross2Icon />
        </button>
        <div className="evidence-list">
          {evidenceSources.map((source) => (
            <EvidenceCard key={source.url} source={source} />
          ))}
        </div>
        <SheetComposer />
      </BottomSheet>
    </div>
  );
}

function AppHeader() {
  return (
    <header className="app-header">
      <button type="button" className="icon-button" aria-label="Open navigation">
        <HamburgerMenuIcon />
      </button>
      <div className="agent-mark" aria-hidden="true">
        <Sparkles />
      </div>
      <div className="agent-title">
        <h1>GTM Research Agent</h1>
        <p>Conversational research for freelancers</p>
      </div>
      <button type="button" className="icon-button" aria-label="Open research settings">
        <MixerHorizontalIcon />
      </button>
    </header>
  );
}

function UserMessage() {
  return (
    <div className="message-row message-row-user">
      <div className="user-bubble">
        <span>Analyze acme.ai</span>
        <small>9:41 AM <CheckIcon /></small>
      </div>
    </div>
  );
}

function AgentAvatar() {
  return (
    <div className="agent-avatar" aria-hidden="true">
      <Workflow />
    </div>
  );
}

function ResearchProgress() {
  return (
    <div className="agent-message-block">
      <AgentAvatar />
      <div className="agent-content">
        <div className="assistant-bubble">
          On it. I’ll research Acme and surface high-leverage GTM opportunities.
          <small>9:41 AM</small>
        </div>
        <section className="progress-card" aria-label="Live research progress">
          <div className="progress-card-header">
            <h2>Researching Acme</h2>
            <span className="live-label"><DotFilledIcon /> Live</span>
          </div>
          <div className="progress-steps">
            {researchSteps.map((step) => (
              <div className="progress-step" key={step.label}>
                <span className={`step-icon step-icon-${step.status}`} aria-hidden="true">
                  {step.status === "done" ? (
                    <CheckCircledIcon />
                  ) : step.status === "active" ? (
                    <ReloadIcon />
                  ) : (
                    <CircleIcon />
                  )}
                </span>
                <span className="step-name">{step.label} · {step.agent}</span>
                <span className={`step-status step-status-${step.status}`}>
                  {step.status === "done" ? "Done" : step.status === "active" ? "In progress" : "Pending"}
                </span>
              </div>
            ))}
          </div>
        </section>
        <div className="message-time">9:41 AM</div>
      </div>
    </div>
  );
}

function CompanyAssessment({
  shortlisted,
  onEvidence,
  onShortlist,
}: {
  shortlisted: boolean;
  onEvidence: () => void;
  onShortlist: () => void;
}) {
  return (
    <div className="agent-message-block assessment-block">
      <AgentAvatar />
      <div className="agent-content">
        <div className="assistant-bubble compact-bubble">
          Here’s what I found about Acme.
          <small>9:41 AM</small>
        </div>
        <section className="company-card" aria-label="Acme company assessment">
          <div className="company-heading">
            <div className="acme-logo">acme</div>
            <div className="company-name">
              <h2>Acme</h2>
              <a href="https://acme.ai">acme.ai <ExternalLinkIcon /></a>
            </div>
            <div className="icp-score"><span>ICP fit</span> <strong>82</strong></div>
          </div>
          <p className="company-summary">AI platform for customer support automation</p>
          <div className="company-facts">
            <span><BackpackIcon /> B2B SaaS</span>
            <span><CalendarIcon /> 2019</span>
            <span><LightningBoltIcon /> Series B</span>
            <span><PersonIcon /> 51–200</span>
          </div>
          <div className="pros-cons">
            <div>
              <h3 className="pros-title">Pros</h3>
              <ul>
                <li><CheckIcon /> Modern stack &amp; AI native</li>
                <li><CheckIcon /> Strong product adoption</li>
                <li><CheckIcon /> Active funding &amp; roadmap</li>
              </ul>
            </div>
            <div>
              <h3 className="cons-title">Cons</h3>
              <ul className="cons-list">
                <li><Cross2Icon /> Limited mid-market focus</li>
                <li><Cross2Icon /> Pricing not transparent</li>
                <li><Cross2Icon /> Limited integrations</li>
              </ul>
            </div>
          </div>
          <div className="opportunity-card">
            <div className="opportunity-icon"><Bot /></div>
            <div className="opportunity-copy">
              <div className="opportunity-title-row">
                <h3>Support Triage Agent</h3>
                <span>High impact</span>
              </div>
              <p>Automate first-line support triage, categorization, and routing.</p>
              <div className="opportunity-metrics">
                <span>Value <strong>High</strong></span>
                <span>Effort <strong className="metric-blue">Medium</strong></span>
                <span>Fit <strong>High</strong></span>
              </div>
            </div>
            <ChevronRightIcon className="opportunity-chevron" />
          </div>
          <div className="action-row">
            <button type="button" onClick={onEvidence}><FileTextIcon /> Evidence</button>
            <button type="button"><QuestionMarkCircledIcon /> Challenge</button>
            <button
              type="button"
              className="shortlist-button"
              aria-label={shortlisted ? "Shortlisted" : "Shortlist"}
              onClick={onShortlist}
            >
              <StarIcon /> {shortlisted ? "Shortlisted" : "Shortlist"}
            </button>
          </div>
        </section>
        <div className="message-time">9:43 AM</div>
      </div>
    </div>
  );
}

function Composer() {
  const { bottomInset } = useKeyboardInsets();
  return (
    <div className="composer" style={{ bottom: bottomInset + 10 }}>
      <button type="button" className="attach-button" aria-label="Attach document"><Link2Icon /></button>
      <KeyboardTextarea
        rows={2}
        aria-label="Message GTM Research Agent"
        placeholder="Ask anything about your market or ideal customers..."
      />
      <button type="button" className="send-button" aria-label="Send message"><PaperPlaneIcon /></button>
    </div>
  );
}

function SheetComposer() {
  return (
    <div className="sheet-composer">
      <button type="button" className="attach-button" aria-label="Attach evidence"><Link2Icon /></button>
      <KeyboardTextarea tabIndex={-1} rows={2} aria-label="Ask about evidence" placeholder="Ask anything about your market or ideal customers..." />
      <button type="button" className="send-button" aria-label="Send evidence question"><PaperPlaneIcon /></button>
    </div>
  );
}

function EvidenceCard({ source }: { source: (typeof evidenceSources)[number] }) {
  return (
    <article className="evidence-card">
      <div className={`source-icon source-icon-${source.tone}`} aria-hidden="true">
        {source.kind === "web" ? <GlobeIcon /> : <FileTextIcon />}
      </div>
      <div className="source-copy">
        <h3>{source.title}</h3>
        <a href={source.url}>{source.url} <ExternalLinkIcon /></a>
        <p>{source.description}</p>
      </div>
      <div className="source-meta">
        <span className={`classification classification-${source.classification.toLowerCase()}`}>
          {source.classification}
        </span>
        <span className="confidence-label">Confidence</span>
        <span className="confidence-dots" aria-label={`${source.confidence} of 5 confidence`}>
          {[1, 2, 3, 4, 5].map((dot) => (
            <DotFilledIcon key={dot} className={dot <= source.confidence ? "filled" : "empty"} />
          ))}
        </span>
      </div>
    </article>
  );
}
