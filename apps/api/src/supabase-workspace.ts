import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { WorkspaceService } from "./server.js";

type SellerProfileRow = {
  id: string;
  owner_id: string;
  business_name: string;
  offer_summary: string;
  capabilities: unknown;
  proof_points: unknown;
  constraints: unknown;
  created_at: string;
  updated_at: string;
};

type ConversationRow = {
  id: string;
  owner_id: string;
  seller_profile_id: string | null;
  icp_definition_id: string | null;
  title: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  owner_id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: unknown;
  sequence: number;
  created_at: string;
};

const sellerProfileColumns = "id,owner_id,business_name,offer_summary,capabilities,proof_points,constraints,created_at,updated_at";
const conversationColumns = "id,owner_id,seller_profile_id,icp_definition_id,title,status,created_at,updated_at";
const messageColumns = "id,owner_id,conversation_id,role,content,sequence,created_at";

function mapSellerProfile(row: SellerProfileRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    businessName: row.business_name,
    offerSummary: row.offer_summary,
    capabilities: row.capabilities,
    proofPoints: row.proof_points,
    constraints: row.constraints,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConversation(row: ConversationRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sellerProfileId: row.seller_profile_id,
    icpDefinitionId: row.icp_definition_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    sequence: row.sequence,
    createdAt: row.created_at,
  };
}

export function createSupabaseWorkspaceService(client: SupabaseClient): WorkspaceService {
  return {
    async getSellerProfile(ownerId) {
      const result = await client
        .from("seller_profiles")
        .select(sellerProfileColumns)
        .eq("owner_id", ownerId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (result.error) throw new Error(`Unable to load seller profile: ${result.error.message}`);
      return result.data ? mapSellerProfile(result.data as SellerProfileRow) : undefined;
    },
    async upsertSellerProfile(ownerId, input) {
      const existing = await this.getSellerProfile(ownerId) as { id: string } | undefined;
      const values = {
        owner_id: ownerId,
        business_name: input.businessName,
        offer_summary: input.offerSummary,
        capabilities: input.capabilities,
        proof_points: input.proofPoints,
        constraints: input.constraints,
        updated_at: new Date().toISOString(),
      };
      const result = existing
        ? await client.from("seller_profiles").update(values).eq("id", existing.id).eq("owner_id", ownerId).select(sellerProfileColumns).single()
        : await client.from("seller_profiles").insert(values).select(sellerProfileColumns).single();
      if (result.error) throw new Error(`Unable to save seller profile: ${result.error.message}`);
      return mapSellerProfile(result.data as SellerProfileRow);
    },
    async createConversation(ownerId, input) {
      const result = await client
        .from("conversations")
        .insert({
          owner_id: ownerId,
          title: input.title,
          seller_profile_id: input.sellerProfileId ?? null,
          icp_definition_id: input.icpDefinitionId ?? null,
        })
        .select(conversationColumns)
        .single();
      if (result.error) throw new Error(`Unable to create conversation: ${result.error.message}`);
      return mapConversation(result.data as ConversationRow);
    },
    async listConversations(ownerId) {
      const result = await client
        .from("conversations")
        .select(conversationColumns)
        .eq("owner_id", ownerId)
        .eq("status", "active")
        .order("updated_at", { ascending: false });
      if (result.error) throw new Error(`Unable to list conversations: ${result.error.message}`);
      return (result.data as ConversationRow[]).map(mapConversation);
    },
    async getConversation(ownerId, conversationId) {
      const result = await client
        .from("conversations")
        .select(conversationColumns)
        .eq("id", conversationId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (result.error) throw new Error(`Unable to load conversation: ${result.error.message}`);
      return result.data ? mapConversation(result.data as ConversationRow) : undefined;
    },
    async appendMessage(ownerId, conversationId, input) {
      if (!await this.getConversation(ownerId, conversationId)) return undefined;
      const result = await client
        .from("messages")
        .insert({
          owner_id: ownerId,
          conversation_id: conversationId,
          role: input.role,
          content: input.content,
        })
        .select(messageColumns)
        .single();
      if (result.error) throw new Error(`Unable to append message: ${result.error.message}`);
      return mapMessage(result.data as MessageRow);
    },
    async listMessages(ownerId, conversationId) {
      if (!await this.getConversation(ownerId, conversationId)) return undefined;
      const result = await client
        .from("messages")
        .select(messageColumns)
        .eq("conversation_id", conversationId)
        .eq("owner_id", ownerId)
        .order("sequence", { ascending: true });
      if (result.error) throw new Error(`Unable to list messages: ${result.error.message}`);
      return (result.data as MessageRow[]).map(mapMessage);
    },
  };
}

export function createEnvironmentWorkspaceService(
  environment: NodeJS.ProcessEnv = process.env,
): WorkspaceService | undefined {
  const url = environment.SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return undefined;
  return createSupabaseWorkspaceService(createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));
}
