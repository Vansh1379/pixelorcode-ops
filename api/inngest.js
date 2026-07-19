import { serve } from "inngest/express";
import { inngest } from "../inngest/client.js";
import { sendCampaign } from "../inngest/sendCampaign.js";
import { checkReplies } from "../inngest/checkReplies.js";

export default serve({ client: inngest, functions: [sendCampaign, checkReplies] });
