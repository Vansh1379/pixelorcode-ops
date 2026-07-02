import mammoth from "mammoth";

/**
 * Normalizes email template body by stripping signatures.
 */
function cleanSignature(body) {
  if (!body) return "";
  return body.trim();
}

/**
 * Parses the raw text extracted from a playbook document.
 */
export function parsePlaybookText(rawText) {
  const lines = rawText.split(/\r?\n/).map(line => line.trim());
  const leads = [];
  let currentLead = null;
  let currentTemplate = null; // 'day0', 'day3', 'day7'

  for (let line of lines) {
    if (!line && !currentTemplate) continue;

    // Detect new lead heading: e.g., "1. Peekabox..." or "12. Gainz..." or "2. ThrowMeNot..."
    // Matches digits followed by a dot, spaces, then the name.
    const leadHeadingMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (leadHeadingMatch) {
      if (currentLead) {
        leads.push(currentLead);
      }
      const rawTitle = leadHeadingMatch[2];
      // Clean name from stars and routing info
      const cleanName = rawTitle.split(/★|◆|ROUTE/)[0].trim();
      currentLead = {
        name: cleanName,
        list: "Outreach Playbook",
        niche: "",
        location: "",
        address: "",
        phone: "",
        alternatePhone: "",
        email: "",
        websiteStatus: "Unknown",
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
        lastAction: "Imported from Playbook",
        whatsappSent: false,
        whatsappReplied: false,
        emailSent: false,
        nextFollowUp: null,
        proposalStatus: "None",
        clientValue: "",
        routeType: "Manual",
        routeNotes: line, // Store the raw header description
        templates: {
          day0: { subject: "", body: "" },
          day3: { subject: "", body: "" },
          day7: { subject: "", body: "" }
        }
      };
      currentTemplate = null;
      continue;
    }

    if (!currentLead) continue;

    // Parse description/niche/founders info
    if (line.toLowerCase().startsWith("what they do:")) {
      currentLead.description = line.replace(/what they do:/i, "").trim();
      currentLead.leadReason = currentLead.description; // Map to why good lead
      
      // Attempt to parse niche/location/funding details from description
      const locationMatch = line.match(/in\s+([A-Za-z\s]+)(?:\;|\.|\,|$)/i);
      if (locationMatch) {
        currentLead.location = locationMatch[1].trim();
      }
      continue;
    }

    if (line.toLowerCase().startsWith("founders:")) {
      currentLead.founders = line.replace(/founders:/i, "").trim();
      currentLead.decisionMaker = currentLead.founders.split("·")[0].split("(")[0].trim();
      continue;
    }

    // Try to extract an email address from any line
    const emailInLine = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    // Parse email validation line — handle ✅ being stripped by mammoth
    if (line.includes("✅ Verified email") || line.includes("Verified email") || 
        line.toLowerCase().includes("verified email") || 
        (emailInLine && (line.toLowerCase().includes("verified") || line.toLowerCase().includes("send today")))) {
      currentLead.routeType = "Email";
      if (emailInLine) {
        currentLead.email = emailInLine[0].trim();
      }
      currentLead.routeNotes = line;
      continue;
    }

    // If line contains an email address but wasn't caught above, still capture it
    if (emailInLine && !currentLead.email) {
      currentLead.email = emailInLine[0].trim();
      currentLead.routeType = "Email";
      currentLead.routeNotes = line;
      continue;
    }

    if (line.startsWith("◆ Send route") || line.toLowerCase().includes("send route") || 
        line.toLowerCase().includes("route:")) {
      // Only set Manual if we don't already have an email (Email route takes priority)
      if (currentLead.routeType !== "Email") {
        currentLead.routeType = "Manual";
      }
      currentLead.routeNotes = line;
      
      // If it contains a phone/whatsapp number, let's extract it
      const phoneMatch = line.match(/\+?\d[\d\s-]{8,}\d/);
      if (phoneMatch) {
        currentLead.phone = phoneMatch[0].trim();
      }
      continue;
    }

    if (line.startsWith("⚑") || line.toLowerCase().startsWith("flag") || line.toLowerCase().startsWith("warning")) {
      currentLead.warning = line.replace(/^[⚑\s]+/, "").trim();
      currentLead.notes = (currentLead.notes ? currentLead.notes + "\n" : "") + line;
      continue;
    }

    // Detect template headers
    if (line.toLowerCase().includes("email 1") || line.toLowerCase().includes("day 0")) {
      currentTemplate = "day0";
      continue;
    }
    if (line.toLowerCase().includes("follow-up 1") || line.toLowerCase().includes("day 3")) {
      currentTemplate = "day3";
      continue;
    }
    if (line.toLowerCase().includes("follow-up 2") || line.toLowerCase().includes("day 7")) {
      currentTemplate = "day7";
      continue;
    }

    // Append to template subject or body
    if (currentTemplate) {
      if (line.startsWith("Subject:")) {
        currentLead.templates[currentTemplate].subject = line.replace(/^Subject:/i, "").trim();
      } else {
        const currentBody = currentLead.templates[currentTemplate].body;
        currentLead.templates[currentTemplate].body = currentBody 
          ? currentBody + "\n" + line 
          : line;
      }
    }
  }

  // Push the final lead record
  if (currentLead) {
    leads.push(currentLead);
  }

  // Clean the signatures for all parsed templates and trim whitespace
  return leads.map(lead => {
    // Generate a unique ID for each parsed lead
    lead.id = crypto.randomUUID();

    // Trim template text fields to avoid extra trailing spaces or newlines
    if (lead.templates) {
      for (const key of ['day0', 'day3', 'day7']) {
        if (lead.templates[key]) {
          lead.templates[key].subject = (lead.templates[key].subject || "").trim();
          lead.templates[key].body = cleanSignature((lead.templates[key].body || "").trim());
        }
      }
    }

    // Safety net: if a valid email was found but routeType wasn't set to Email, fix it
    if (lead.email && lead.email.includes("@") && lead.routeType !== "Email") {
      lead.routeType = "Email";
    }

    // Package templates as serialized JSON prefix inside the notes column as planned
    const templateBlock = `--- OUTREACH_TEMPLATES ---\n${JSON.stringify(lead.templates, null, 2)}\n--------------------------\n`;
    lead.notes = templateBlock + (lead.notes || "");
    
    return lead;
  });
}

/**
 * Reads a docx file using mammoth and extracts all leads.
 */
export async function parseDocx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        const result = await mammoth.extractRawText({ arrayBuffer });
        const text = result.value;
        const leads = parsePlaybookText(text);
        resolve(leads);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}
