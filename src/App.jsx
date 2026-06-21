import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Copy,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Filter,
  Globe,
  Import,
  LayoutDashboard,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import pixelorCodeLogo from "./assets/pixelorcode-profile.png";
import {
  deleteLeadRecord,
  getProposalPdfUrl,
  isSupabaseConfigured,
  loadWorkspaceData,
  saveLeadRecord,
  saveLeadRecords,
  saveProposalRecord,
  uploadProposalPdf,
} from "./lib/dataStore";
import { getCurrentSession, onAuthChange, signInWithPassword, signOut } from "./lib/supabaseClient";

const EMPTY_DATA = {
  __version: "loading",
  generatedAt: "",
  leads: [],
  proposals: [],
};

const STATUS_OPTIONS = [
  "Not Contacted",
  "Verified",
  "WhatsApp Ready",
  "WhatsApp Sent",
  "Email Sent",
  "Called",
  "Replied",
  "Interested",
  "Follow Up",
  "Proposal Sent",
  "Meeting",
  "Closed",
  "Lost",
  "Bounced",
  "Wrong Number",
];

const PROPOSAL_OPTIONS = ["None", "Drafting", "Sent", "Approved", "Rejected", "Closed"];
const OWNERS = ["Unassigned", "Rishav", "Vansh", "Sales Team", "Design", "Ops"];
const PAGE_SIZE = 100;
const VIEWS = ["command", "followups", "leads", "outreach", "proposals", "clients", "reports", "settings"];

// The magic-link redirect lands with #access_token=…&refresh_token=… in the hash.
// Only treat the hash as a view name if it's actually one of our views.
function initialView() {
  const raw = (window.location.hash || "").replace(/^#/, "").split(/[&=]/)[0];
  return VIEWS.includes(raw) ? raw : "command";
}

const blankLead = {
  name: "",
  list: "Manual",
  niche: "",
  location: "",
  address: "",
  phone: "",
  alternatePhone: "",
  email: "",
  websiteStatus: "",
  rating: "",
  reviews: "",
  sourceLink: "",
  otherLink: "",
  leadReason: "",
  pitch: "",
  decisionMaker: "",
  openingHours: "",
  notes: "",
  status: "Not Contacted",
  owner: "Unassigned",
  lastAction: "Created",
  whatsappSent: false,
  whatsappReplied: false,
  emailSent: false,
  nextFollowUp: "",
  proposalStatus: "None",
  clientValue: "",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function waPhoneDigits(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) digits = `91${digits}`;
  else if (digits.startsWith("0")) digits = `91${digits.replace(/^0+/, "")}`;
  return digits;
}

function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function followUpState(lead) {
  if (!lead.nextFollowUp || ["Closed", "Lost"].includes(lead.status)) return "none";
  const todayIso = today();
  if (lead.nextFollowUp < todayIso) return "overdue";
  if (lead.nextFollowUp === todayIso) return "today";
  return "upcoming";
}

const CONTACTED_STATUSES = ["WhatsApp Sent", "Email Sent", "Called", "Follow Up"];

// A lead is "stale" if it was contacted, has no scheduled follow-up, the trail
// has gone quiet for 7+ days, and it hasn't reached a terminal state.
function isStale(lead) {
  if (lead.nextFollowUp) return false;
  if (["Closed", "Lost", "Not Contacted"].includes(lead.status)) return false;
  const contacted = lead.whatsappSent || lead.emailSent || CONTACTED_STATUSES.includes(lead.status);
  if (!contacted) return false;
  const last = lead.updatedAt || lead.createdAt;
  if (!last) return false;
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
  return days >= 7;
}

// Rough local-time helper for international leads (no per-lead tz stored).
const TZ_OFFSETS = [
  { match: /brisbane/i, label: "Brisbane", offset: 10 },
  { match: /adelaide/i, label: "Adelaide", offset: 9.5 },
  { match: /\bAU\b|australia/i, label: "AU", offset: 10 },
  { match: /austin|TX|texas|columbus|OH|ohio/i, label: "US Central/East", offset: -5 },
  { match: /phoenix|AZ|arizona/i, label: "Phoenix", offset: -7 },
  { match: /tampa|FL|florida|charlotte|NC/i, label: "US East", offset: -4 },
];
function localTimeFor(lead) {
  const hay = `${lead.location} ${lead.list} ${lead.address}`;
  const tz = TZ_OFFSETS.find((t) => t.match.test(hay));
  if (!tz) return null;
  const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
  const local = new Date(utcMs + tz.offset * 3600000);
  const hh = local.getHours();
  const mm = String(local.getMinutes()).padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  const business = hh >= 9 && hh < 18;
  return { text: `${h12}:${mm} ${ampm} (${tz.label})`, business };
}

function ContactActions({ lead, size = 13 }) {
  const wa = waPhoneDigits(lead.phone);
  const tel = String(lead.phone || "").replace(/[^+\d]/g, "");
  const email = String(lead.email || "");
  if (!wa && !tel && !email.includes("@")) return null;
  return (
    <div className="contact-actions">
      {wa && (
        <a className="action-chip whatsapp" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          <MessageCircle size={size} /> WhatsApp
        </a>
      )}
      {tel && (
        <a className="action-chip" href={`tel:${tel}`} onClick={(event) => event.stopPropagation()}>
          <Phone size={size} /> Call
        </a>
      )}
      {email.includes("@") && (
        <a className="action-chip" href={`mailto:${email}`} onClick={(event) => event.stopPropagation()}>
          <Mail size={size} /> Email
        </a>
      )}
    </div>
  );
}

function firstNameOf(lead) {
  const name = String(lead.decisionMaker || "").trim();
  if (!name || /not (found|added|available|confirmed)/i.test(name)) return "";
  return name.replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, "").split(/\s+/)[0];
}

// Build a ready-to-send opener from the lead's own data + saved pitch.
function buildOpener(lead) {
  const fname = firstNameOf(lead);
  const greeting = fname ? `Hi ${fname}` : `Hi ${lead.name} team`;
  const pitch = String(lead.pitch || "").trim();
  const body = pitch
    ? pitch
    : `I came across ${lead.name}${lead.location ? ` in ${lead.location}` : ""} and had a couple of ideas that could help you get more enquiries online.`;
  return `${greeting} 👋\n\n${body}\n\nWould it be worth sharing a quick concept?\n\n— PixelorCode · pixelorcode.com`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label = "Copy", copiedLabel = "Copied!" }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      className="button ghost copy-btn"
      onClick={async (event) => {
        event.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <CheckCircle2 size={15} /> : <Copy size={15} />} {done ? copiedLabel : label}
    </button>
  );
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isLinkedInUrl(value) {
  return /(^https?:\/\/)?(www\.)?linkedin\.com/i.test(String(value || "").trim());
}

function getNoteLink(notes, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(notes || "").match(new RegExp(`${escaped}:\\s*(https?:\\/\\/\\S+)`, "i"));
  return match?.[1] || "";
}

function getLeadLinks(lead) {
  const sourceLink = lead?.sourceLink || "";
  const otherLink = lead?.otherLink || "";
  const website = isHttpUrl(otherLink) && !isLinkedInUrl(otherLink)
    ? otherLink
    : isHttpUrl(sourceLink) && !isLinkedInUrl(sourceLink)
      ? sourceLink
      : "";
  const companyLinkedIn = isLinkedInUrl(sourceLink)
    ? sourceLink
    : isLinkedInUrl(otherLink)
      ? otherLink
      : "";
  return {
    website,
    companyLinkedIn,
    personLinkedIn: getNoteLink(lead?.notes, "Person LinkedIn"),
  };
}

function normalizeImportedLead(row, index, listName) {
  const pick = (...names) => {
    for (const name of names) {
      const value = row[name];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return "";
  };
  const normalizeStatus = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "Not Contacted";
    const lowered = raw.toLowerCase();
    if (["not called", "not contacted", "new"].includes(lowered)) return "Not Contacted";
    if (lowered.includes("bounce")) return "Bounced";
    if (lowered.includes("sent") || lowered.includes("done")) return "Email Sent";
    if (lowered.includes("follow")) return "Follow Up";
    if (lowered.includes("interested")) return "Interested";
    if (lowered.includes("wrong")) return "Wrong Number";
    return raw;
  };

  return {
    ...blankLead,
    id: `import-${Date.now()}-${index}`,
    sourceId: pick("Lead ID", "ID") || `IMP-${index + 1}`,
    name: pick("Business Name", "Clinic Name", "Company Name", "Startup Name", "Lead Name", "Name"),
    list: listName || pick("List", "Source List") || "Imported List",
    niche: pick("Education Segment", "Specialty", "Industry", "Business Type", "Niche"),
    location: pick("Area / Locality", "Location", "City", "Country"),
    address: pick("Full Address", "Address"),
    phone: pick("Phone Number", "Phone", "Primary Phone"),
    alternatePhone: pick("Alternate Phone", "Alt Phone"),
    email: pick("Email", "Email Address"),
    websiteStatus: pick("Website Status", "Website Quality", "Website") || "Unknown",
    rating: pick("Rating"),
    reviews: pick("Review Count", "Reviews"),
    sourceLink: pick("Primary Source Link", "Google Maps / Directory Link", "Source Link", "Company Website", "Website"),
    otherLink: pick("Other Profile Link", "LinkedIn", "LinkedIn URL"),
    leadReason: pick("Why This Is A Good Lead", "Lead Description", "Why Good Lead"),
    pitch: pick("Suggested Call Pitch", "Pitch", "Suggested Email Angle"),
    decisionMaker: pick("Decision Maker / Contact Person", "Founder Name", "Contact Person"),
    openingHours: pick("Opening Hours"),
    notes: pick("Notes", "Source Verification Notes", "Website Verification Notes"),
    status: normalizeStatus(pick("Call Status", "Outreach Status", "Email Status", "Status")),
    owner: "Unassigned",
    lastAction: "Imported",
    proposalStatus: "None",
    createdAt: today(),
    updatedAt: today(),
  };
}

function rowsToObjects(rows) {
  const [headerRow, ...bodyRows] = rows;
  const headers = (headerRow || []).map((header) => String(header || "").trim());
  return bodyRows
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  row.push(current);
  rows.push(row);
  return rowsToObjects(rows);
}

function StatCard({ label, value, sublabel, icon: Icon, tone = "blue", active = false, onClick }) {
  return (
    <button className={`stat-card tone-${tone} ${active ? "active" : ""}`} onClick={onClick} type="button">
      <div className="stat-icon"><Icon size={18} /></div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{sublabel}</span>
      </div>
    </button>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status || "New").toLowerCase().replace(/\s+/g, "-");
  return <span className={`status-badge status-${normalized}`}>{status || "New"}</span>;
}

function AgendaWidget({ stats, onJump, onMetric }) {
  const items = [
    { key: "due", icon: Bell, count: stats.due, label: "Follow-ups due", hint: "Overdue + today — clear before new sends", action: () => onJump("followups"), tone: stats.due > 0 ? "alert" : "calm" },
    { key: "responses", icon: MessageCircle, count: stats.responses, label: "Replies to action", hint: "Replied · interested · meetings", action: () => onMetric("responses"), tone: stats.responses > 0 ? "good" : "calm" },
    { key: "stale", icon: AlertTriangle, count: stats.stale, label: "Going stale", hint: "Contacted 7d+ ago, no follow-up set", action: () => onMetric("stale"), tone: stats.stale > 0 ? "alert" : "calm" },
    { key: "proposals", icon: FileText, count: stats.proposals, label: "Proposals in play", hint: "Sent or active — chase to close", action: () => onMetric("proposals"), tone: "calm" },
  ];
  return (
    <div className="agenda-strip">
      <div className="agenda-title"><Sparkles size={16} /> Today's agenda</div>
      <div className="agenda-items">
        {items.map(({ key, icon: Icon, count, label, hint, action, tone }) => (
          <button key={key} className={`agenda-item tone-${tone}`} onClick={action} type="button">
            <Icon size={18} />
            <div>
              <strong>{count.toLocaleString("en-IN")}</strong>
              <p>{label}</p>
              <span>{hint}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value, href }) {
  return (
    <div className="field">
      <span>{label}</span>
      {href && value ? (
        <a href={href} target="_blank" rel="noreferrer">{value}</a>
      ) : (
        <strong>{value || "Not added"}</strong>
      )}
    </div>
  );
}

function LinkButton({ href, children }) {
  if (!href) return null;
  return (
    <a className="link-chip" href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
      {children}
    </a>
  );
}

function AuthGate({ onDemoMode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    try {
      setIsSending(true);
      setMessage("");
      await signInWithPassword(email.trim(), password);
    } catch (error) {
      setMessage(`Login failed: ${error.message}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand auth-brand">
          <div className="brand-mark"><img src={pixelorCodeLogo} alt="PixelOrCode" /></div>
          <div>
            <strong>PixelOrCode Ops</strong>
            <span>Secure team access</span>
          </div>
        </div>
        <h1>Sign in to the shared CRM</h1>
        <p>Enter your team email and password. Access is restricted to approved accounts — there is no public sign-up.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="team@pixelorcode.com" autoComplete="username" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" autoComplete="current-password" required />
        </label>
        <button className="button primary" type="submit" disabled={isSending}>{isSending ? "Signing in..." : "Sign in"}</button>
        <button className="button ghost" type="button" onClick={onDemoMode}>View safe demo</button>
        {message && <span className="auth-message">{message}</span>}
      </form>
    </div>
  );
}

function ProposalUploader({ leads, onAddProposal }) {
  const [draft, setDraft] = useState({
    client: "",
    value: "",
    phone: "",
    email: "",
    service: "Website + CRM",
    status: "Sent",
    sentDate: today(),
    validUntil: "",
    nextStep: "",
    notes: "",
  });
  const [fileName, setFileName] = useState("");
  const [proposalFile, setProposalFile] = useState(null);
  const uploadRef = useRef(null);

  const matchedLead = useMemo(() => {
    if (!draft.client) return null;
    return leads.find((lead) => lead.name.toLowerCase() === draft.client.toLowerCase());
  }, [draft.client, leads]);

  const update = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    setProposalFile(file);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!draft.client.trim()) return;
    onAddProposal({
      id: `proposal-${Date.now()}`,
      leadName: draft.client.trim(),
      client: draft.client.trim(),
      status: draft.status,
      value: draft.value,
      phone: draft.phone || matchedLead?.phone || "",
      email: draft.email || matchedLead?.email || "",
      owner: matchedLead?.owner || "Sales Team",
      service: draft.service,
      sentDate: draft.sentDate,
      validUntil: draft.validUntil,
      nextStep: draft.nextStep,
      notes: draft.notes,
      fileName,
      fileType: "application/pdf",
    }, proposalFile);
    setDraft({
      client: "",
      value: "",
      phone: "",
      email: "",
      service: "Website + CRM",
      status: "Sent",
      sentDate: today(),
      validUntil: "",
      nextStep: "",
      notes: "",
    });
    setFileName("");
    setProposalFile(null);
    if (uploadRef.current) uploadRef.current.value = "";
  };

  return (
    <form className="proposal-uploader" onSubmit={submit}>
      <div className="panel-title compact">
        <div>
          <p>Proposal PDF</p>
          <h2>Upload proposal</h2>
        </div>
        <FileText size={20} />
      </div>
      <div className="proposal-form-grid">
        <label>Client<input list="lead-names" value={draft.client} onChange={(e) => update("client", e.target.value)} placeholder="Client or lead name" required /></label>
        <datalist id="lead-names">{leads.map((lead) => <option key={lead.id} value={lead.name} />)}</datalist>
        <label>Value<input value={draft.value} onChange={(e) => update("value", e.target.value)} placeholder="26000" /></label>
        <label>Phone<input value={draft.phone} onChange={(e) => update("phone", e.target.value)} placeholder={matchedLead?.phone || "Phone number"} /></label>
        <label>Email<input value={draft.email} onChange={(e) => update("email", e.target.value)} placeholder={matchedLead?.email || "Email"} /></label>
        <label>Service<input value={draft.service} onChange={(e) => update("service", e.target.value)} /></label>
        <label>Status<select value={draft.status} onChange={(e) => update("status", e.target.value)}>{PROPOSAL_OPTIONS.filter((option) => option !== "None").map((status) => <option key={status}>{status}</option>)}</select></label>
        <label>Sent date<input type="date" value={draft.sentDate} onChange={(e) => update("sentDate", e.target.value)} /></label>
        <label>Valid until<input type="date" value={draft.validUntil} onChange={(e) => update("validUntil", e.target.value)} /></label>
        <label className="span-2">Next step<input value={draft.nextStep} onChange={(e) => update("nextStep", e.target.value)} placeholder="Payment pending, design in progress..." /></label>
        <label className="span-2">Notes<textarea rows="2" value={draft.notes} onChange={(e) => update("notes", e.target.value)} /></label>
      </div>
      <div className="proposal-upload-row">
        <input ref={uploadRef} type="file" accept="application/pdf,.pdf" onChange={(e) => handleFile(e.target.files?.[0])} hidden />
        <button type="button" className="button ghost" onClick={() => uploadRef.current?.click()}><Import size={16} /> Choose PDF</button>
        <span>{fileName || "No PDF selected"}</span>
        <button type="submit" className="button primary"><Plus size={16} /> Add proposal</button>
      </div>
    </form>
  );
}

function LeadEditor({ lead, onClose, onSave }) {
  const [draft, setDraft] = useState(lead || { ...blankLead });
  const isNew = !lead?.id;

  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            ...blankLead,
            ...draft,
            id: draft.id || `lead-${Date.now()}`,
            sourceId: draft.sourceId || `MAN-${Date.now().toString().slice(-5)}`,
            createdAt: draft.createdAt || today(),
            updatedAt: today(),
          });
        }}
      >
        <div className="modal-head">
          <div>
            <p>{isNew ? "Add new lead" : "Edit lead"}</p>
            <h2>{isNew ? "Create lead record" : draft.name}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close editor"><X size={18} /></button>
        </div>

        <div className="form-grid">
          <label>Business name<input value={draft.name} onChange={(e) => update("name", e.target.value)} required /></label>
          <label>List<input value={draft.list} onChange={(e) => update("list", e.target.value)} /></label>
          <label>Niche<input value={draft.niche} onChange={(e) => update("niche", e.target.value)} /></label>
          <label>Location<input value={draft.location} onChange={(e) => update("location", e.target.value)} /></label>
          <label>Phone<input value={draft.phone} onChange={(e) => update("phone", e.target.value)} /></label>
          <label>Email<input value={draft.email} onChange={(e) => update("email", e.target.value)} /></label>
          <label>Website status<input value={draft.websiteStatus} onChange={(e) => update("websiteStatus", e.target.value)} /></label>
          <label>Source / LinkedIn link<input value={draft.sourceLink} onChange={(e) => update("sourceLink", e.target.value)} /></label>
          <label>Website / other link<input value={draft.otherLink} onChange={(e) => update("otherLink", e.target.value)} /></label>
          <label>Owner<select value={draft.owner} onChange={(e) => update("owner", e.target.value)}>{OWNERS.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
          <label>Status<select value={draft.status} onChange={(e) => update("status", e.target.value)}>{STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label>Proposal<select value={draft.proposalStatus} onChange={(e) => update("proposalStatus", e.target.value)}>{PROPOSAL_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label>Next follow-up<input type="date" value={draft.nextFollowUp || ""} onChange={(e) => update("nextFollowUp", e.target.value)} /></label>
          <label>Client value<input value={draft.clientValue} onChange={(e) => update("clientValue", e.target.value)} /></label>
          <label className="span-2">Address<textarea rows="2" value={draft.address} onChange={(e) => update("address", e.target.value)} /></label>
          <label className="span-2">Why good lead<textarea rows="3" value={draft.leadReason} onChange={(e) => update("leadReason", e.target.value)} /></label>
          <label className="span-2">Pitch<textarea rows="3" value={draft.pitch} onChange={(e) => update("pitch", e.target.value)} /></label>
          <label className="span-2">Notes<textarea rows="3" value={draft.notes} onChange={(e) => update("notes", e.target.value)} /></label>
        </div>

        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary">Save lead</button>
        </div>
      </form>
    </div>
  );
}

function Sidebar({ activeView, setActiveView, counts, dataMode }) {
  const items = [
    ["command", "Command", LayoutDashboard],
    ["followups", "Follow-ups", Bell],
    ["leads", "Leads", FileSpreadsheet],
    ["outreach", "Outreach", MessageCircle],
    ["proposals", "Proposals", FileText],
    ["clients", "Clients", Briefcase],
    ["reports", "Reports", BarChart3],
    ["settings", "Settings", Settings],
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><img src={pixelorCodeLogo} alt="PixelOrCode" /></div>
        <div>
          <strong>PixelOrCode</strong>
          <span>Ops control</span>
        </div>
      </div>

      <nav>
        {items.map(([key, label, Icon]) => (
          <button key={key} className={activeView === key ? "active" : ""} onClick={() => setActiveView(key)}>
            <Icon size={18} />
            <span>{label}</span>
            {key === "leads" && <em>{counts.leads}</em>}
            {key === "followups" && counts.due > 0 && <em className="due">{counts.due}</em>}
          </button>
        ))}
      </nav>

      <div className="sidebar-status">
        <div>
          <span>{dataMode === "supabase" ? "Database mode" : "Safe demo mode"}</span>
          <strong>{counts.lists} lists loaded</strong>
        </div>
        <div className="storage-bar"><span style={{ width: `${Math.min(100, counts.leads / 8)}%` }} /></div>
        <small>{dataMode === "supabase" ? "Supabase sync active. Shared team data." : "No private leads are bundled in this build."}</small>
      </div>
    </aside>
  );
}

function LeadTable({ leads, selectedId, setSelectedId, onEdit, onDelete, checkedIds = new Set(), onToggleCheck, onToggleAll }) {
  const allChecked = leads.length > 0 && leads.every((lead) => checkedIds.has(lead.id));
  const showChecks = Boolean(onToggleCheck);
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {showChecks && (
              <th className="check-col">
                <input type="checkbox" checked={allChecked} onChange={(e) => onToggleAll?.(leads, e.target.checked)} aria-label="Select all" />
              </th>
            )}
            <th>Business</th>
            <th>List / niche</th>
            <th>Location</th>
            <th>Website</th>
            <th>Contact</th>
            <th>Last action</th>
            <th>Status</th>
            <th>Owner</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const links = getLeadLinks(lead);
            return (
              <tr key={lead.id} className={`${selectedId === lead.id ? "selected" : ""} ${checkedIds.has(lead.id) ? "checked" : ""}`} onClick={() => setSelectedId(lead.id)}>
                {showChecks && (
                  <td className="check-col" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" checked={checkedIds.has(lead.id)} onChange={() => onToggleCheck(lead.id)} aria-label={`Select ${lead.name}`} />
                  </td>
                )}
                <td>
                  <strong>{lead.name}</strong>
                  <span>{lead.decisionMaker || lead.sourceId || "No contact person"}</span>
                </td>
                <td>
                  <strong>{lead.list}</strong>
                  <span>{lead.niche || "Uncategorized"}</span>
                </td>
                <td>{lead.location || "Not added"}</td>
                <td>
                  <div className="link-stack">
                    <div className="link-row">
                      <LinkButton href={links.website}>Website</LinkButton>
                      <LinkButton href={links.companyLinkedIn}>Company LinkedIn</LinkButton>
                      <LinkButton href={links.personLinkedIn}>Person LinkedIn</LinkButton>
                    </div>
                    <span className="website-pill">{lead.websiteStatus || "Unknown"}</span>
                  </div>
                </td>
                <td>
                  <span className="contact-line"><Phone size={13} /> {lead.phone || "No phone"}</span>
                  <span className="contact-line"><Mail size={13} /> {lead.email || "No email"}</span>
                  <ContactActions lead={lead} />
                </td>
                <td>
                  {lead.lastAction || "Imported"}
                  {followUpState(lead) === "overdue" && <span className="fu-tag overdue">Follow-up overdue · {lead.nextFollowUp}</span>}
                  {followUpState(lead) === "today" && <span className="fu-tag today">Due today</span>}
                </td>
                <td><StatusBadge status={lead.status} /></td>
                <td>{lead.owner || "Unassigned"}</td>
                <td>
                  <div className="row-actions">
                    <button className="icon-button" onClick={(event) => { event.stopPropagation(); onEdit(lead); }} aria-label={`Edit ${lead.name}`}><Edit3 size={15} /></button>
                    <button className="icon-button danger" onClick={(event) => { event.stopPropagation(); onDelete(lead.id); }} aria-label={`Delete ${lead.name}`}><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {leads.length === 0 && <div className="empty">No leads match this view.</div>}
    </div>
  );
}

function LeadDetail({ lead, onUpdate, onEdit }) {
  const [tab, setTab] = useState("overview");
  if (!lead) return <aside className="detail-panel empty-panel">Select a lead to inspect details.</aside>;
  const links = getLeadLinks(lead);

  const quickAction = (status, lastAction, proposalStatus = lead.proposalStatus) => {
    // process rule: every send/call books its own +3d follow-up; a reply gets
    // chased next day; closed/lost leaves the queue.
    const isTouch = /whatsapp|email|called|proposal/i.test(lastAction);
    const nextFollowUp = ["Closed", "Lost"].includes(status)
      ? ""
      : status === "Replied"
        ? addDaysIso(1)
        : isTouch
          ? addDaysIso(3)
          : lead.nextFollowUp;
    onUpdate({
      ...lead,
      status,
      lastAction: `${lastAction} · ${today()}`,
      proposalStatus,
      nextFollowUp,
      whatsappSent: lead.whatsappSent || /whatsapp/i.test(lastAction),
      whatsappReplied: lead.whatsappReplied || status === "Replied",
      emailSent: lead.emailSent || /email/i.test(lastAction),
      updatedAt: today(),
    });
  };

  return (
    <aside className="detail-panel">
      <div className="detail-head">
        <div>
          <span>{lead.list}</span>
          <h2>{lead.name}</h2>
          <p>{lead.niche} · {lead.location || "Location pending"}</p>
          <ContactActions lead={lead} size={15} />
        </div>
        <button className="icon-button" onClick={() => onEdit(lead)} aria-label="Edit selected lead"><Edit3 size={17} /></button>
      </div>

      <div className="tabs">
        {["overview", "outreach", "proposal", "notes"].map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="detail-content">
          <div className="status-row">
            <StatusBadge status={lead.status} />
            <span>{lead.proposalStatus || "No proposal"}</span>
          </div>
          {(() => {
            const lt = localTimeFor(lead);
            return lt ? (
              <div className={`tz-badge ${lt.business ? "ok" : "off"}`}>
                <Globe size={14} /> Their local time: <strong>{lt.text}</strong> · {lt.business ? "business hours ✓" : "outside hours"}
              </div>
            ) : null;
          })()}
          <Field label="Phone" value={lead.phone} />
          <Field label="Email" value={lead.email} href={lead.email?.includes("@") ? `mailto:${lead.email}` : ""} />
          <Field label="Website status" value={lead.websiteStatus} />
          <Field label="Decision maker" value={lead.decisionMaker} />
          <Field label="Website" value={links.website ? "Open website" : "Not added"} href={links.website} />
          <Field label="Company LinkedIn" value={links.companyLinkedIn ? "Open company LinkedIn" : "Not added"} href={links.companyLinkedIn} />
          <Field label="Person LinkedIn" value={links.personLinkedIn ? "Open person LinkedIn" : "Not added"} href={links.personLinkedIn} />
          <div className="text-block">
            <span>Why this is a good lead</span>
            <p>{lead.leadReason || "No lead reasoning added yet."}</p>
          </div>
        </div>
      )}

      {tab === "outreach" && (
        <div className="detail-content">
          <div className="quick-grid">
            <button onClick={() => quickAction("WhatsApp Sent", "WhatsApp sent")}><MessageCircle size={16} /> Mark WhatsApp</button>
            <button onClick={() => quickAction("Email Sent", "Email sent")}><Mail size={16} /> Mark email</button>
            <button onClick={() => quickAction("Called", "Called")}><Phone size={16} /> Mark call</button>
            <button onClick={() => quickAction("Replied", "Replied")}><Bell size={16} /> Mark reply</button>
          </div>
          <div className="text-block">
            <span>Ready-to-send opener</span>
            <p>{buildOpener(lead)}</p>
            <div className="copy-row">
              <CopyButton text={buildOpener(lead)} label="Copy message" />
              {lead.pitch && <CopyButton text={lead.pitch} label="Copy pitch only" />}
              {lead.email?.includes("@") && <CopyButton text={lead.email} label="Copy email" />}
            </div>
          </div>
          <Field label="Next follow-up" value={lead.nextFollowUp} />
          <Field label="Opening hours" value={lead.openingHours} />
        </div>
      )}

      {tab === "proposal" && (
        <div className="detail-content">
          <label className="select-field">
            Proposal status
            <select value={lead.proposalStatus || "None"} onChange={(e) => onUpdate({ ...lead, proposalStatus: e.target.value, updatedAt: today() })}>
              {PROPOSAL_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <div className="quick-grid">
            <button onClick={() => quickAction("Proposal Sent", "Proposal sent", "Sent")}><FileText size={16} /> Proposal sent</button>
            <button onClick={() => quickAction("Meeting", "Meeting scheduled")}><Users size={16} /> Meeting</button>
            <button onClick={() => quickAction("Closed", "Payment received", "Closed")}><CheckCircle2 size={16} /> Payment received</button>
            <button onClick={() => quickAction("Lost", "Deal lost", "Rejected")}><X size={16} /> Lost</button>
          </div>
          <Field label="Estimated value" value={lead.clientValue ? `₹${lead.clientValue}` : ""} />
          <Field label="Last action" value={lead.lastAction} />
        </div>
      )}

      {tab === "notes" && (
        <div className="detail-content">
          <div className="text-block tall">
            <span>Internal notes</span>
            <p>{lead.notes || "No notes added."}</p>
          </div>
          <Field label="Address" value={lead.address} />
          <Field label="Raw source link" value={lead.sourceLink ? lead.sourceLink : ""} href={lead.sourceLink} />
          <Field label="Raw other link" value={lead.otherLink ? lead.otherLink : ""} href={lead.otherLink} />
        </div>
      )}
    </aside>
  );
}

function ProposalsView({ proposals, leads, onAddProposal }) {
  const closedLeads = leads.filter((lead) => lead.status === "Closed" || lead.proposalStatus === "Closed");
  const openProposal = async (proposal) => {
    if (!proposal.filePath) {
      window.alert("No private PDF is attached to this proposal yet.");
      return;
    }
    const signedUrl = await getProposalPdfUrl(proposal.filePath);
    if (signedUrl) window.open(signedUrl, "_blank", "noopener,noreferrer");
  };

  const downloadProposal = async (proposal) => {
    if (!proposal.filePath) {
      window.alert("No private PDF is attached to this proposal yet.");
      return;
    }
    const signedUrl = await getProposalPdfUrl(proposal.filePath);
    if (!signedUrl) return;
    const link = document.createElement("a");
    link.href = signedUrl;
    link.download = proposal.fileName || `${proposal.client}-proposal.pdf`;
    link.click();
  };

  return (
    <div className="proposal-page">
      <ProposalUploader leads={leads} onAddProposal={onAddProposal} />
      <div className="split-grid">
      <section className="panel">
        <div className="panel-title">
          <div>
            <p>Pipeline</p>
            <h2>Proposal PDFs</h2>
          </div>
          <FileText size={20} />
        </div>
        <div className="proposal-card-list">
          {proposals.map((proposal) => (
            <article className="proposal-card" key={proposal.id}>
              <div className="proposal-card-head">
                <div>
                  <span>{proposal.service || "Website / CRM"}</span>
                  <strong>{proposal.client}</strong>
                </div>
                <StatusBadge status={proposal.status} />
              </div>
              <div className="proposal-meta-grid">
                <Field label="Amount" value={proposal.value ? `₹${Number(proposal.value).toLocaleString("en-IN")}` : "Value pending"} />
                <Field label="Phone" value={proposal.phone} />
                <Field label="Email" value={proposal.email} />
                <Field label="Sent date" value={proposal.sentDate} />
                <Field label="Valid until" value={proposal.validUntil} />
                <Field label="Owner" value={proposal.owner} />
              </div>
              <div className="proposal-file-row">
                <div>
                  <FileText size={17} />
                  <span>{proposal.fileName || "No PDF attached"}</span>
                </div>
                <button className="button ghost" onClick={() => openProposal(proposal)}>Open PDF</button>
                <button className="button ghost" onClick={() => downloadProposal(proposal)}>Download</button>
              </div>
              <div className="text-block">
                <span>Next step</span>
                <p>{proposal.nextStep || "No next step added."}</p>
              </div>
              {proposal.notes && <div className="proposal-note">{proposal.notes}</div>}
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">
          <div>
            <p>Revenue</p>
            <h2>Closed clients</h2>
          </div>
          <Briefcase size={20} />
        </div>
        <div className="proposal-list">
          {closedLeads.length ? closedLeads.slice(0, 12).map((lead) => (
            <article key={lead.id}>
              <div>
                <strong>{lead.name}</strong>
                <span>{lead.list} · {lead.location}</span>
              </div>
              <StatusBadge status="Closed" />
              <b>{lead.clientValue ? `₹${Number(lead.clientValue).toLocaleString("en-IN")}` : "Value pending"}</b>
            </article>
          )) : <div className="empty small">Closed clients will appear here once marked.</div>}
        </div>
      </section>
      </div>
    </div>
  );
}

function ReportsView({ leads, lists }) {
  const contactedOf = (l) => l.whatsappSent || l.emailSent || /sent|called|replied|interested|follow|meeting|proposal|closed/i.test(l.status);
  const repliedOf = (l) => l.whatsappReplied || ["Replied", "Interested", "Follow Up", "Meeting", "Proposal Sent", "Closed"].includes(l.status);
  const closedOf = (l) => l.status === "Closed" || l.proposalStatus === "Closed";

  // per-owner scoreboard
  const owners = Array.from(new Set(leads.map((l) => l.owner || "Unassigned"))).sort();

  // duplicate detection by normalized phone
  const phoneGroups = {};
  leads.forEach((l) => {
    const key = String(l.phone || "").replace(/\D/g, "").replace(/^0+/, "");
    if (key.length >= 8) (phoneGroups[key] = phoneGroups[key] || []).push(l);
  });
  const dupes = Object.entries(phoneGroups).filter(([, g]) => g.length > 1).sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="reports-stack">
      <section className="panel report-panel">
        <div className="panel-title"><div><p>Reporting</p><h2>Reply rate by list</h2></div><BarChart3 size={20} /></div>
        <div className="report-table">
          <div className="report-row report-head"><span>List</span><span>Leads</span><span>Contacted</span><span>Replied</span><span>Reply rate</span><span>Closed</span></div>
          {lists.map((list) => {
            const ls = leads.filter((l) => l.list === list);
            const contacted = ls.filter(contactedOf).length;
            const replied = ls.filter(repliedOf).length;
            const closed = ls.filter(closedOf).length;
            const rate = contacted ? Math.round((replied / contacted) * 100) : 0;
            const rateClass = rate >= 8 ? "good" : rate >= 4 ? "ok" : "low";
            return (
              <div className="report-row" key={list}>
                <span className="report-name">{list}</span><span>{ls.length}</span><span>{contacted}</span><span>{replied}</span>
                <span className={`report-rate ${rateClass}`}>{contacted ? `${rate}%` : "—"}</span><span>{closed}</span>
              </div>
            );
          })}
        </div>
        <p className="report-note">Reply rate = replied ÷ contacted. Target ≥5%. Under 4% after 100 sends → rewrite the opener.</p>
      </section>

      <section className="panel report-panel">
        <div className="panel-title"><div><p>Accountability</p><h2>Per-person scoreboard</h2></div><Users size={20} /></div>
        <div className="report-table">
          <div className="report-row report-head"><span>Owner</span><span>Leads</span><span>Contacted</span><span>Replied</span><span>Reply rate</span><span>Closed</span></div>
          {owners.map((owner) => {
            const ls = leads.filter((l) => (l.owner || "Unassigned") === owner);
            const contacted = ls.filter(contactedOf).length;
            const replied = ls.filter(repliedOf).length;
            const closed = ls.filter(closedOf).length;
            const rate = contacted ? Math.round((replied / contacted) * 100) : 0;
            return (
              <div className="report-row" key={owner}>
                <span className="report-name">{owner}</span><span>{ls.length}</span><span>{contacted}</span><span>{replied}</span>
                <span className="report-rate">{contacted ? `${rate}%` : "—"}</span><span>{closed}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel report-panel">
        <div className="panel-title"><div><p>Data quality</p><h2>Duplicate phone numbers ({dupes.length})</h2></div><AlertTriangle size={20} /></div>
        {dupes.length === 0 ? (
          <div className="empty small">No duplicate phone numbers found. Clean list ✓</div>
        ) : (
          <div className="dupe-list">
            {dupes.slice(0, 40).map(([key, group]) => (
              <article className="dupe-group" key={key}>
                <div className="dupe-phone">+{key} · {group.length}×</div>
                <div className="dupe-names">{group.map((l) => <span key={l.id}>{l.name} <em>({l.list})</em></span>)}</div>
              </article>
            ))}
            {dupes.length > 40 && <p className="report-note">Showing first 40 of {dupes.length} duplicate groups.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(EMPTY_DATA);
  const [dataMode, setDataMode] = useState(isSupabaseConfigured ? "supabase" : "demo");
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(!isSupabaseConfigured);
  const [forceDemo, setForceDemo] = useState(!isSupabaseConfigured);
  const [isLoading, setIsLoading] = useState(true);
  const [syncMessage, setSyncMessage] = useState("");
  const [activeView, setActiveView] = useState(initialView);
  const [query, setQuery] = useState("");
  const [listFilter, setListFilter] = useState("All lists");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [metricFilter, setMetricFilter] = useState(() => new URLSearchParams(window.location.search).get("metric") || "total");
  const [selectedId, setSelectedId] = useState("");
  const [editingLead, setEditingLead] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [sortKey, setSortKey] = useState("updated");
  const [page, setPage] = useState(0);
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [lastBulk, setLastBulk] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    setPage(0);
    setCheckedIds(new Set());
  }, [query, listFilter, statusFilter, metricFilter, activeView, sortKey]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    // Once Supabase has read the magic-link token from the URL hash, strip it
    // so it never lingers in the address bar. Safe here — session is resolved.
    const cleanAuthHash = () => {
      if (/access_token=|refresh_token=|error=/.test(window.location.hash || "")) {
        window.history.replaceState(null, "", `${window.location.pathname}#${initialView()}`);
      }
    };
    getCurrentSession()
      .then((currentSession) => {
        if (!active) return;
        setSession(currentSession);
        setAuthChecked(true);
        cleanAuthHash();
      })
      .catch((error) => {
        if (!active) return;
        setSyncMessage(`Auth check failed: ${error.message}`);
        setAuthChecked(true);
      });
    const unsubscribe = onAuthChange((currentSession) => {
      setSession(currentSession);
      if (currentSession) setForceDemo(false);
      cleanAuthHash();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadData() {
      if (isSupabaseConfigured && !session && !forceDemo) {
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        const loaded = await loadWorkspaceData({ forceDemo });
        if (!active) return;
        setData(loaded);
        setDataMode(loaded.mode || (isSupabaseConfigured ? "supabase" : "demo"));
        setSelectedId(loaded.leads[0]?.id || "");
        setSyncMessage(loaded.mode === "supabase" ? "Database connected" : "Safe demo data loaded");
      } catch (error) {
        if (!active) return;
        setData(EMPTY_DATA);
        setSyncMessage(`Database load failed: ${error.message}`);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    loadData();
    return () => {
      active = false;
    };
  }, [session, forceDemo]);

  const refreshData = async () => {
    const loaded = await loadWorkspaceData({ forceDemo });
    setData(loaded);
    setDataMode(loaded.mode || (isSupabaseConfigured ? "supabase" : "demo"));
    setSelectedId((current) => current || loaded.leads[0]?.id || "");
    setSyncMessage(loaded.mode === "supabase" ? "Database refreshed" : "Safe demo data refreshed");
  };

  const handleSignOut = async () => {
    await signOut();
    setSession(null);
    setData(EMPTY_DATA);
    setSelectedId("");
  };

  const navigate = (view) => {
    setActiveView(view);
    window.history.replaceState(null, "", `#${view}`);
  };

  const toggleCheck = (id) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (rows, checked) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      rows.forEach((row) => (checked ? next.add(row.id) : next.delete(row.id)));
      return next;
    });
  };

  // Apply one change to every checked lead and persist the batch.
  // Snapshots prior state so the action can be undone in one click.
  const bulkApply = async (mutator, message) => {
    const ids = checkedIds;
    if (!ids.size) return;
    if (ids.size >= 25 && !window.confirm(`Apply "${message}" to ${ids.size} leads?`)) return;
    const snapshot = [];
    const changed = [];
    const nextLeads = data.leads.map((lead) => {
      if (!ids.has(lead.id)) return lead;
      snapshot.push({ ...lead });
      const updated = { ...lead, ...mutator(lead), updatedAt: today() };
      changed.push(updated);
      return updated;
    });
    setData({ ...data, leads: nextLeads });
    setCheckedIds(new Set());
    try {
      if (dataMode === "supabase") await saveLeadRecords(changed);
      setLastBulk({ snapshot, message, at: Date.now() });
      setSyncMessage(`${changed.length} leads · ${message}`);
    } catch (error) {
      setSyncMessage(`Bulk update failed: ${error.message}`);
    }
  };

  // Restore the exact pre-bulk state of the last batch.
  const undoBulk = async () => {
    if (!lastBulk) return;
    const restore = new Map(lastBulk.snapshot.map((l) => [l.id, l]));
    const nextLeads = data.leads.map((lead) => restore.get(lead.id) || lead);
    setData({ ...data, leads: nextLeads });
    const snapshot = lastBulk.snapshot;
    setLastBulk(null);
    try {
      if (dataMode === "supabase") await saveLeadRecords(snapshot);
      setSyncMessage(`Undone · ${snapshot.length} leads restored`);
    } catch (error) {
      setSyncMessage(`Undo failed: ${error.message}`);
    }
  };

  const lists = useMemo(() => Array.from(new Set(data.leads.map((lead) => lead.list).filter(Boolean))).sort(), [data.leads]);

  const filteredLeads = useMemo(() => {
    const term = query.trim().toLowerCase();
    return data.leads.filter((lead) => {
      const matchesQuery = !term || [lead.name, lead.list, lead.niche, lead.location, lead.phone, lead.email, lead.websiteStatus, lead.status, lead.decisionMaker, lead.notes, lead.sourceId, lead.owner]
        .some((value) => String(value || "").toLowerCase().includes(term));
      const matchesList = listFilter === "All lists" || lead.list === listFilter;
      const matchesStatus = statusFilter === "All statuses" || lead.status === statusFilter;
      return matchesQuery && matchesList && matchesStatus;
    });
  }, [data.leads, query, listFilter, statusFilter]);

  const selectedLead = filteredLeads.find((lead) => lead.id === selectedId) || filteredLeads[0] || data.leads[0];

  const matchesMetric = (lead, metric) => {
    if (metric === "total") return true;
    if (metric === "due") return ["overdue", "today"].includes(followUpState(lead));
    if (metric === "stale") return isStale(lead);
    if (metric === "emails") return Boolean(lead.emailSent);
    if (metric === "whatsapp") return Boolean(lead.whatsappSent) || /whatsapp/i.test(lead.status);
    if (metric === "responses") return Boolean(lead.whatsappReplied) || ["Replied", "Interested", "Follow Up", "Meeting"].includes(lead.status);
    if (metric === "proposals") return Boolean(lead.proposalStatus && lead.proposalStatus !== "None");
    if (metric === "closed") return lead.status === "Closed" || lead.proposalStatus === "Closed";
    return true;
  };

  const stats = useMemo(() => {
    const leads = data.leads;
    const count = (predicate) => leads.filter(predicate).length;
    const proposalClients = new Set(data.proposals.map((proposal) => proposal.client));
    return {
      total: leads.length,
      due: count((lead) => ["overdue", "today"].includes(followUpState(lead))),
      stale: count(isStale),
      emailsSent: count((lead) => lead.emailSent),
      whatsapp: count((lead) => lead.whatsappSent || /whatsapp/i.test(lead.status)),
      responses: count((lead) => lead.whatsappReplied || ["Replied", "Interested", "Follow Up", "Meeting"].includes(lead.status)),
      proposals: data.proposals.length + count((lead) => lead.proposalStatus && lead.proposalStatus !== "None" && !proposalClients.has(lead.name)),
      closed: count((lead) => lead.status === "Closed" || lead.proposalStatus === "Closed"),
      lists: lists.length,
      leads: leads.length,
    };
  }, [data.leads, data.proposals.length, lists.length]);

  const updateLead = async (updatedLead) => {
    const nextLeads = data.leads.map((lead) => lead.id === updatedLead.id ? updatedLead : lead);
    setData({ ...data, leads: nextLeads });
    try {
      if (dataMode === "supabase") await saveLeadRecord(updatedLead);
      setSyncMessage(dataMode === "supabase" ? "Lead synced to database" : "Demo mode: shared database write skipped");
    } catch (error) {
      setSyncMessage(`Lead sync failed: ${error.message}`);
    }
  };

  const saveLead = async (lead) => {
    const exists = data.leads.some((item) => item.id === lead.id);
    const nextLeads = exists ? data.leads.map((item) => item.id === lead.id ? lead : item) : [lead, ...data.leads];
    setData({ ...data, leads: nextLeads });
    setSelectedId(lead.id);
    setEditingLead(null);
    setIsCreating(false);
    try {
      if (dataMode === "supabase") await saveLeadRecord(lead);
      setSyncMessage(dataMode === "supabase" ? "Lead saved to database" : "Demo mode: shared database write skipped");
    } catch (error) {
      setSyncMessage(`Lead save failed: ${error.message}`);
    }
  };

  const deleteLead = async (id) => {
    const lead = data.leads.find((item) => item.id === id);
    if (!lead || !window.confirm(`Delete ${lead.name}?`)) return;
    const nextLeads = data.leads.filter((item) => item.id !== id);
    setData({ ...data, leads: nextLeads });
    if (selectedId === id) setSelectedId(nextLeads[0]?.id);
    try {
      if (dataMode === "supabase") await deleteLeadRecord(id);
      setSyncMessage(dataMode === "supabase" ? "Lead deleted from database" : "Demo mode: shared database delete skipped");
    } catch (error) {
      setSyncMessage(`Lead delete failed: ${error.message}`);
    }
  };

  const addProposal = async (proposal, proposalFile) => {
    const proposalWithFile = {
      ...proposal,
      filePath: proposalFile ? "" : proposal.filePath || "",
    };
    const nextProposals = [proposalWithFile, ...data.proposals];
    const nextLeads = data.leads.map((lead) => {
      if (lead.name.toLowerCase() !== proposalWithFile.client.toLowerCase()) return lead;
      return {
        ...lead,
        status: proposalWithFile.status === "Closed" ? "Closed" : "Proposal Sent",
        proposalStatus: proposalWithFile.status,
        clientValue: proposalWithFile.value || lead.clientValue,
        phone: proposalWithFile.phone || lead.phone,
        email: proposalWithFile.email || lead.email,
        lastAction: `Proposal ${proposalWithFile.status.toLowerCase()}${proposalWithFile.sentDate ? ` on ${proposalWithFile.sentDate}` : ""}`,
        updatedAt: today(),
      };
    });
    setData({ ...data, proposals: nextProposals, leads: nextLeads });
    try {
      const filePath = dataMode === "supabase" ? await uploadProposalPdf(proposalFile, proposalWithFile.id) : "";
      const savedProposal = dataMode === "supabase"
        ? await saveProposalRecord({ ...proposalWithFile, filePath })
        : { ...proposalWithFile, filePath };
      const matchingLead = nextLeads.find((lead) => lead.name.toLowerCase() === savedProposal.client.toLowerCase());
      if (matchingLead && dataMode === "supabase") await saveLeadRecord(matchingLead);
      setData((current) => ({
        ...current,
        proposals: current.proposals.map((item) => item.id === savedProposal.id ? savedProposal : item),
      }));
      setSyncMessage(dataMode === "supabase" ? "Proposal saved to database" : "Demo mode: private PDF storage skipped");
    } catch (error) {
      setSyncMessage(`Proposal save failed: ${error.message}`);
    }
  };

  const exportCsv = (rows) => {
    const dataset = Array.isArray(rows) && rows.length ? rows : data.leads;
    const headers = ["name", "list", "niche", "location", "phone", "alternatePhone", "email", "websiteStatus", "status", "owner", "decisionMaker", "proposalStatus", "nextFollowUp", "leadReason", "pitch", "notes"];
    const csv = [headers.join(","), ...dataset.map((lead) => headers.map((header) => csvEscape(lead[header])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pixelorcode-leads-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importXlsx = async (file) => {
    if (!file) return;
    const rows = /\.csv$/i.test(file.name)
      ? parseCsv(await file.text())
      : rowsToObjects(await (await import("read-excel-file/browser")).default(file));
    const imported = rows
      .map((row, index) => normalizeImportedLead(row, index, file.name.replace(/\.(xlsx|xls|csv)$/i, "")))
      .filter((lead) => lead.name);
    setData({ ...data, leads: [...imported, ...data.leads] });
    if (imported[0]) setSelectedId(imported[0].id);
    fileRef.current.value = "";
    try {
      if (dataMode === "supabase") await saveLeadRecords(imported);
      setSyncMessage(dataMode === "supabase" ? `${imported.length} leads imported into database` : "Demo mode: shared database import skipped");
    } catch (error) {
      setSyncMessage(`Import sync failed: ${error.message}`);
    }
  };

  const resetData = async () => {
    if (!window.confirm("Reload dashboard data from the connected database or safe demo source?")) return;
    await refreshData();
  };

  const selectMetric = (metric) => {
    setMetricFilter(metric);
    setActiveView("command");
    window.history.replaceState(null, "", `${window.location.pathname}?metric=${metric}#command`);
  };

  const showLeads = ["command", "leads", "outreach", "clients", "followups"].includes(activeView);
  const viewLeads = activeView === "outreach"
    ? filteredLeads.filter((lead) => ["WhatsApp Ready", "WhatsApp Sent", "Email Sent", "Called", "Replied", "Interested", "Follow Up"].includes(lead.status))
    : activeView === "clients"
      ? filteredLeads.filter((lead) => lead.status === "Closed" || lead.proposalStatus === "Closed")
      : activeView === "followups"
        ? filteredLeads.filter((lead) => ["overdue", "today"].includes(followUpState(lead)))
        : filteredLeads;
  const visibleLeads = showLeads ? viewLeads.filter((lead) => matchesMetric(lead, metricFilter)) : viewLeads;
  const sortedLeads = useMemo(() => {
    const copy = [...visibleLeads];
    if (activeView === "followups" || sortKey === "followup") {
      copy.sort((a, b) => (a.nextFollowUp || "9999").localeCompare(b.nextFollowUp || "9999"));
    } else if (sortKey === "name") {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      copy.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    }
    return copy;
  }, [visibleLeads, sortKey, activeView]);
  const pageCount = Math.max(1, Math.ceil(sortedLeads.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedLeads = sortedLeads.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const metricLabels = {
    total: "All leads",
    due: "Due follow-ups",
    stale: "Stale (7d+, no follow-up)",
    emails: "Emails sent",
    whatsapp: "WhatsApp sent",
    responses: "Responses",
    proposals: "Proposals",
    closed: "Closed",
  };

  // Mark the currently-selected lead via keyboard (mirrors detail-panel quick actions).
  const markSelected = (status, action) => {
    const lead = selectedLead;
    if (!lead) return;
    updateLead({
      ...lead,
      status,
      lastAction: `${action} · ${today()}`,
      nextFollowUp: status === "Replied" ? addDaysIso(1) : ["Closed", "Lost"].includes(status) ? "" : addDaysIso(3),
      whatsappSent: lead.whatsappSent || /whatsapp/i.test(action),
      whatsappReplied: lead.whatsappReplied || status === "Replied",
      emailSent: lead.emailSent || /email/i.test(action),
      updatedAt: today(),
    });
  };

  useEffect(() => {
    const onKey = (event) => {
      const tag = (event.target.tagName || "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!showLeads || !pagedLeads.length) return;
      const idx = pagedLeads.findIndex((l) => l.id === selectedLead?.id);
      const key = event.key.toLowerCase();
      if (key === "j" || key === "arrowdown") { event.preventDefault(); setSelectedId(pagedLeads[Math.min(pagedLeads.length - 1, idx + 1)]?.id); }
      else if (key === "k" || key === "arrowup") { event.preventDefault(); setSelectedId(pagedLeads[Math.max(0, idx - 1)]?.id); }
      else if (key === "w") markSelected("WhatsApp Sent", "WhatsApp sent");
      else if (key === "e") markSelected("Email Sent", "Email sent");
      else if (key === "c") markSelected("Called", "Called");
      else if (key === "r") markSelected("Replied", "Replied");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (isSupabaseConfigured && !forceDemo && !authChecked) {
    return <div className="auth-shell"><div className="auth-card"><p>Checking secure session...</p></div></div>;
  }

  if (isSupabaseConfigured && !forceDemo && !session) {
    return <AuthGate onDemoMode={() => setForceDemo(true)} />;
  }

  return (
    <div className="app">
      <Sidebar activeView={activeView} setActiveView={navigate} counts={stats} dataMode={dataMode} />

      <main>
        <header className="topbar">
          <div>
            <p>PixelOrCode command center</p>
            <h1>{activeView === "command" ? "Agency growth operations" : activeView.charAt(0).toUpperCase() + activeView.slice(1)}</h1>
            <span className={`sync-pill ${dataMode === "supabase" ? "connected" : "demo"}`}>
              {isLoading ? "Loading workspace..." : syncMessage}
            </span>
          </div>
          <div className="top-actions">
            <div className="search-box">
              <Search size={17} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search leads, list, city, phone, email..." />
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={(e) => importXlsx(e.target.files?.[0])} hidden />
            <button className="button ghost" onClick={() => fileRef.current?.click()}><Import size={16} /> Import XLSX</button>
            <button className="button ghost" onClick={() => exportCsv(showLeads ? sortedLeads : data.leads)} title="Exports the current filtered view"><Download size={16} /> Export</button>
            {isSupabaseConfigured && session && <button className="button ghost" onClick={handleSignOut}>Sign out</button>}
            <button className="button primary" onClick={() => setIsCreating(true)}><Plus size={16} /> Add lead</button>
          </div>
        </header>

        <section className="stats-grid">
          <StatCard label="Total leads" value={stats.total.toLocaleString("en-IN")} sublabel={`${stats.lists} active lists`} icon={FileSpreadsheet} active={metricFilter === "total"} onClick={() => selectMetric("total")} />
          <StatCard label="Due follow-ups" value={stats.due.toLocaleString("en-IN")} sublabel="Overdue + due today" icon={Bell} tone="amber" active={metricFilter === "due"} onClick={() => selectMetric("due")} />
          <StatCard label="Going stale" value={stats.stale.toLocaleString("en-IN")} sublabel="Contacted 7d+, no follow-up" icon={AlertTriangle} tone="amber" active={metricFilter === "stale"} onClick={() => selectMetric("stale")} />
          <StatCard label="Emails sent" value={stats.emailsSent.toLocaleString("en-IN")} sublabel="Across all lists" icon={Mail} tone="orange" active={metricFilter === "emails"} onClick={() => selectMetric("emails")} />
          <StatCard label="WhatsApp sent" value={stats.whatsapp.toLocaleString("en-IN")} sublabel="Across all lists" icon={MessageCircle} tone="green" active={metricFilter === "whatsapp"} onClick={() => selectMetric("whatsapp")} />
          <StatCard label="Responses" value={stats.responses.toLocaleString("en-IN")} sublabel="Replied · interested · meetings" icon={Bell} tone="amber" active={metricFilter === "responses"} onClick={() => selectMetric("responses")} />
          <StatCard label="Proposals" value={stats.proposals.toLocaleString("en-IN")} sublabel="Sent or active" icon={FileText} tone="purple" active={metricFilter === "proposals"} onClick={() => selectMetric("proposals")} />
          <StatCard label="Closed" value={stats.closed.toLocaleString("en-IN")} sublabel="Payment received only" icon={CircleDollarSign} tone="green" active={metricFilter === "closed"} onClick={() => selectMetric("closed")} />
        </section>

        <section className="workspace">
          <div className="workspace-main">
            {isLoading && <div className="empty">Loading workspace data...</div>}
            {showLeads && (
              <>
                <div className="toolbar">
                  <div>
                    <h2>{activeView === "followups" ? "Follow-up queue" : activeView === "outreach" ? "Outreach queue" : activeView === "clients" ? "Closed clients" : "Lead database"}</h2>
                    <span>{sortedLeads.length.toLocaleString("en-IN")} records · {metricLabels[metricFilter]}{activeView === "followups" ? " · oldest due first — clear these before new sends" : ""}</span>
                  </div>
                  <div className="filters">
                    <label><Filter size={15} /> <select value={listFilter} onChange={(e) => setListFilter(e.target.value)}><option>All lists</option>{lists.map((list) => <option key={list}>{list}</option>)}</select></label>
                    <label><ChevronDown size={15} /> <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option>All statuses</option>{STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
                    <label><ChevronDown size={15} /> <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}><option value="updated">Recently updated</option><option value="followup">Follow-up date</option><option value="name">Name A–Z</option></select></label>
                  </div>
                </div>

                {activeView === "command" && (
                  <AgendaWidget stats={stats} onJump={(view) => navigate(view)} onMetric={selectMetric} />
                )}

                {lastBulk && (
                  <div className="undo-bar">
                    <span>Last bulk action: {lastBulk.snapshot.length} leads · {lastBulk.message}</span>
                    <button onClick={undoBulk}><RotateCcw size={15} /> Undo</button>
                    <button className="undo-dismiss" onClick={() => setLastBulk(null)}><X size={14} /></button>
                  </div>
                )}

                {checkedIds.size > 0 && (
                  <div className="bulk-bar">
                    <strong>{checkedIds.size} selected</strong>
                    <button onClick={() => bulkApply((l) => ({ status: "WhatsApp Sent", whatsappSent: true, lastAction: `WhatsApp sent · ${today()}`, nextFollowUp: addDaysIso(3) }), "marked WhatsApp Sent (+3d follow-up)")}><MessageCircle size={15} /> WhatsApp Sent</button>
                    <button onClick={() => bulkApply((l) => ({ status: "Email Sent", emailSent: true, lastAction: `Email sent · ${today()}`, nextFollowUp: addDaysIso(3) }), "marked Email Sent (+3d follow-up)")}><Mail size={15} /> Email Sent</button>
                    <button onClick={() => bulkApply(() => ({ nextFollowUp: addDaysIso(3) }), "follow-up set +3 days")}><Bell size={15} /> Follow-up +3d</button>
                    <label className="bulk-owner"><Users size={15} />
                      <select defaultValue="" onChange={(e) => { if (e.target.value) { bulkApply(() => ({ owner: e.target.value }), `assigned to ${e.target.value}`); e.target.value = ""; } }}>
                        <option value="" disabled>Assign owner…</option>
                        {OWNERS.map((owner) => <option key={owner}>{owner}</option>)}
                      </select>
                    </label>
                    <button className="bulk-clear" onClick={() => setCheckedIds(new Set())}><X size={15} /> Clear</button>
                  </div>
                )}

                <LeadTable leads={pagedLeads} selectedId={selectedLead?.id} setSelectedId={setSelectedId} onEdit={setEditingLead} onDelete={deleteLead} checkedIds={checkedIds} onToggleCheck={toggleCheck} onToggleAll={toggleAll} />

                {sortedLeads.length > PAGE_SIZE && (
                  <div className="pager">
                    <span>
                      {(safePage * PAGE_SIZE + 1).toLocaleString("en-IN")}–{Math.min((safePage + 1) * PAGE_SIZE, sortedLeads.length).toLocaleString("en-IN")} of {sortedLeads.length.toLocaleString("en-IN")}
                    </span>
                    <button className="button ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button>
                    <button className="button ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</button>
                  </div>
                )}
              </>
            )}

            {activeView === "proposals" && <ProposalsView proposals={data.proposals} leads={data.leads} onAddProposal={addProposal} />}
            {activeView === "reports" && (
              <ReportsView leads={data.leads} lists={lists} />
            )}
            {activeView === "settings" && (
              <section className="panel settings-panel">
                <div className="panel-title"><div><p>System</p><h2>Database workspace settings</h2></div><Settings size={20} /></div>
                <p>{dataMode === "supabase" ? "Supabase is connected. Lead, proposal, import, and PDF changes sync through the shared database/storage layer." : "This public-safe build is in demo mode because Supabase environment keys are not configured. No private lead sheet or proposal PDF is bundled into the frontend."}</p>
                <div className="settings-grid">
                  <Field label="Data source" value={dataMode === "supabase" ? "Supabase Postgres" : "Safe demo data"} />
                  <Field label="PDF storage" value={dataMode === "supabase" ? "Private Supabase Storage bucket" : "Disabled in demo mode"} />
                  <Field label="Shared team edits" value={dataMode === "supabase" ? "Active" : "Waiting for database env keys"} />
                </div>
                <button className="button ghost" onClick={resetData}>Reload workspace data</button>
              </section>
            )}
          </div>

          {showLeads && <LeadDetail lead={selectedLead} onUpdate={updateLead} onEdit={setEditingLead} />}
        </section>
      </main>

      {(editingLead || isCreating) && <LeadEditor lead={editingLead} onClose={() => { setEditingLead(null); setIsCreating(false); }} onSave={saveLead} />}
    </div>
  );
}
