import { tool } from "@opencode-ai/plugin";

function applicationTool(name: string, description: string) {
  return tool({
    description,
    args: {
      input: tool.schema.any().describe("Structured input for the application tool."),
    },
    async execute({ input }, context) {
      const url = process.env.GTM_TOOL_BRIDGE_URL;
      const secret = process.env.GTM_TOOL_BRIDGE_SECRET;
      if (!url || !secret) throw new Error("The GTM tool bridge is unavailable");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sessionId: context.sessionID, toolName: name, input }),
        signal: context.abort,
      });
      const payload = await response.json() as { output?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error ?? `GTM tool ${name} failed`);
      return JSON.stringify(payload.output ?? null);
    },
  });
}

export const get_seller_profile = applicationTool("get_seller_profile", "Return the seller's approved service profile and positioning constraints.");
export const get_icp_definition = applicationTool("get_icp_definition", "Return the current ideal-customer criteria used for fit analysis.");
export const fetch_page = applicationTool("fetch_page", "Read bounded excerpts from an already validated company-site crawl.");
export const save_evidence = applicationTool("save_evidence", "Save sourced evidence with provenance and confidence.");
export const search_evidence = applicationTool("search_evidence", "Return evidence collected in the current research run.");
export const get_claim_sources = applicationTool("get_claim_sources", "Return source-bearing evidence for claim verification.");
export const list_open_hypotheses = applicationTool("list_open_hypotheses", "Return unresolved research hypotheses.");
export const get_opportunities = applicationTool("get_opportunities", "Return opportunity evidence and synthesis inputs.");
export const get_company_profile = applicationTool("get_company_profile", "Return company-profile evidence.");
export const compare_companies = applicationTool("compare_companies", "Compare collected company evidence using consistent criteria.");
export const read_document = applicationTool("read_document", "Read an authorized document from application storage.");
export const extract_document_text = applicationTool("extract_document_text", "Extract bounded text from an authorized document.");
