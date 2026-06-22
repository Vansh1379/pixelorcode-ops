import { demoData } from "../demoData";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const PROPOSAL_BUCKET = "proposal-pdfs";

const leadColumns = `
  id, source_id, name, list, niche, location, address, phone, alternate_phone, email,
  website_status, rating, reviews, source_link, other_link, lead_reason, pitch,
  decision_maker, opening_hours, notes, status, owner, last_action, whatsapp_sent,
  whatsapp_replied, email_sent, next_follow_up, proposal_status, client_value,
  created_at, updated_at
`;

const proposalColumns = `
  id, lead_name, client, status, value, phone, email, owner, service, sent_date,
  valid_until, next_step, file_name, file_type, file_path, notes, created_at, updated_at
`;

function fromLeadRow(row) {
  return {
    id: row.id,
    sourceId: row.source_id || "",
    name: row.name || "",
    list: row.list || "",
    niche: row.niche || "",
    location: row.location || "",
    address: row.address || "",
    phone: row.phone || "",
    alternatePhone: row.alternate_phone || "",
    email: row.email || "",
    websiteStatus: row.website_status || "",
    rating: row.rating || "",
    reviews: row.reviews || "",
    sourceLink: row.source_link || "",
    otherLink: row.other_link || "",
    leadReason: row.lead_reason || "",
    pitch: row.pitch || "",
    decisionMaker: row.decision_maker || "",
    openingHours: row.opening_hours || "",
    notes: row.notes || "",
    status: row.status || "Not Contacted",
    owner: row.owner || "Unassigned",
    lastAction: row.last_action || "Imported",
    whatsappSent: Boolean(row.whatsapp_sent),
    whatsappReplied: Boolean(row.whatsapp_replied),
    emailSent: Boolean(row.email_sent),
    nextFollowUp: row.next_follow_up || "",
    proposalStatus: row.proposal_status || "None",
    clientValue: row.client_value || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function toLeadRow(lead) {
  return {
    id: lead.id,
    source_id: lead.sourceId || "",
    name: lead.name || "",
    list: lead.list || "",
    niche: lead.niche || "",
    location: lead.location || "",
    address: lead.address || "",
    phone: lead.phone || "",
    alternate_phone: lead.alternatePhone || "",
    email: lead.email || "",
    website_status: lead.websiteStatus || "",
    rating: lead.rating || "",
    reviews: lead.reviews || "",
    source_link: lead.sourceLink || "",
    other_link: lead.otherLink || "",
    lead_reason: lead.leadReason || "",
    pitch: lead.pitch || "",
    decision_maker: lead.decisionMaker || "",
    opening_hours: lead.openingHours || "",
    notes: lead.notes || "",
    status: lead.status || "Not Contacted",
    owner: lead.owner || "Unassigned",
    last_action: lead.lastAction || "Imported",
    whatsapp_sent: Boolean(lead.whatsappSent),
    whatsapp_replied: Boolean(lead.whatsappReplied),
    email_sent: Boolean(lead.emailSent),
    next_follow_up: lead.nextFollowUp || null,
    proposal_status: lead.proposalStatus || "None",
    client_value: lead.clientValue || "",
    created_at: lead.createdAt || new Date().toISOString().slice(0, 10),
    updated_at: lead.updatedAt || new Date().toISOString().slice(0, 10),
  };
}

function fromProposalRow(row) {
  return {
    id: row.id,
    leadName: row.lead_name || "",
    client: row.client || "",
    status: row.status || "Sent",
    value: row.value || "",
    phone: row.phone || "",
    email: row.email || "",
    owner: row.owner || "Sales Team",
    service: row.service || "",
    sentDate: row.sent_date || "",
    validUntil: row.valid_until || "",
    nextStep: row.next_step || "",
    fileName: row.file_name || "",
    fileType: row.file_type || "application/pdf",
    filePath: row.file_path || "",
    notes: row.notes || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function toProposalRow(proposal) {
  return {
    id: proposal.id,
    lead_name: proposal.leadName || proposal.client || "",
    client: proposal.client || "",
    status: proposal.status || "Sent",
    value: proposal.value || "",
    phone: proposal.phone || "",
    email: proposal.email || "",
    owner: proposal.owner || "Sales Team",
    service: proposal.service || "",
    sent_date: proposal.sentDate || null,
    valid_until: proposal.validUntil || null,
    next_step: proposal.nextStep || "",
    file_name: proposal.fileName || "",
    file_type: proposal.fileType || "application/pdf",
    file_path: proposal.filePath || "",
    notes: proposal.notes || "",
    created_at: proposal.createdAt || new Date().toISOString().slice(0, 10),
    updated_at: proposal.updatedAt || new Date().toISOString().slice(0, 10),
  };
}

function requireSupabase() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

// Supabase caps each select at 1,000 rows — page through to load the full table.
async function fetchAllLeads(client) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("leads")
      .select(leadColumns)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export async function loadWorkspaceData(options = {}) {
  if (!isSupabaseConfigured || options.forceDemo) {
    return { ...demoData, mode: "demo" };
  }

  const client = requireSupabase();
  const [leads, { data: proposals, error: proposalError }] = await Promise.all([
    fetchAllLeads(client),
    client.from("proposals").select(proposalColumns).order("updated_at", { ascending: false }),
  ]);

  if (proposalError) throw proposalError;

  return {
    __version: "supabase-v1",
    generatedAt: new Date().toISOString(),
    mode: "supabase",
    leads: (leads || []).map(fromLeadRow),
    proposals: (proposals || []).map(fromProposalRow),
  };
}

export async function saveLeadRecord(lead) {
  if (!isSupabaseConfigured) return lead;
  const { data, error } = await requireSupabase()
    .from("leads")
    .upsert(toLeadRow(lead), { onConflict: "id" })
    .select(leadColumns)
    .single();
  if (error) throw error;
  return fromLeadRow(data);
}

export async function saveLeadRecords(leads) {
  if (!isSupabaseConfigured || leads.length === 0) return leads;
  const { data, error } = await requireSupabase()
    .from("leads")
    .upsert(leads.map(toLeadRow), { onConflict: "id" })
    .select(leadColumns);
  if (error) throw error;
  return (data || []).map(fromLeadRow);
}

export async function deleteLeadRecord(id) {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase().from("leads").delete().eq("id", id);
  if (error) throw error;
}

// Live updates: push every leads row change to the callback so all open
// browsers stay in sync. Requires Realtime enabled for the `leads` table.
// Returns an unsubscribe function.
export function subscribeToLeads({ onUpsert, onDelete }) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channel = supabase
    .channel("leads-stream")
    .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, (payload) => {
      if (payload.eventType === "DELETE") {
        onDelete?.(payload.old?.id);
      } else {
        onUpsert?.(fromLeadRow(payload.new));
      }
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function saveProposalRecord(proposal) {
  if (!isSupabaseConfigured) return proposal;
  const { data, error } = await requireSupabase()
    .from("proposals")
    .upsert(toProposalRow(proposal), { onConflict: "id" })
    .select(proposalColumns)
    .single();
  if (error) throw error;
  return fromProposalRow(data);
}

export async function uploadProposalPdf(file, proposalId) {
  if (!isSupabaseConfigured || !file) return "";
  const safeName = file.name.replace(/[^a-z0-9_.-]/gi, "-").toLowerCase();
  const path = `${proposalId}/${Date.now()}-${safeName}`;
  const { error } = await requireSupabase().storage.from(PROPOSAL_BUCKET).upload(path, file, {
    contentType: file.type || "application/pdf",
    upsert: true,
  });
  if (error) throw error;
  return path;
}

export async function getProposalPdfUrl(path) {
  if (!isSupabaseConfigured || !path) return "";
  const { data, error } = await requireSupabase()
    .storage
    .from(PROPOSAL_BUCKET)
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data?.signedUrl || "";
}

export { isSupabaseConfigured };
