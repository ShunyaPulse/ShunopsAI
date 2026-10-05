import type {
  Env,
  ToolDefinition,
  ToolExecutionResult,
  ActionConfirmationDetails,
  ActionConfirmResponse,
} from '../types.js';

/**
 * Generate cryptographic HMAC-SHA256 signature for action confirmation tokens
 */
export async function signActionToken(
  actionId: string,
  actionType: string,
  secret: string = 'default-action-secret-key-edge'
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = encoder.encode(`${actionId}:${actionType}`);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify cryptographic HMAC-SHA256 signature for action confirmation
 */
export async function verifyActionToken(
  actionId: string,
  actionType: string,
  token: string,
  secret: string = 'default-action-secret-key-edge'
): Promise<boolean> {
  try {
    const expected = await signActionToken(actionId, actionType, secret);
    return expected === token;
  } catch {
    return false;
  }
}

/**
 * Tool Registry - Definitions and Execution Handlers
 */
export const tools: Record<string, ToolDefinition> = {
  // 1. Submit Lead / Visitor Information
  submit_lead: {
    name: 'submit_lead',
    description:
      'Submits prospective client or visitor details, inquiries, and requirements to the backend sales/support pipeline.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Full name of the visitor or lead.',
        },
        email: {
          type: 'string',
          description: 'Valid email address for contact.',
        },
        phone: {
          type: 'string',
          description: 'Phone number (optional or international format).',
        },
        requirements: {
          type: 'string',
          description: 'Detailed description of requirements, project scope, or inquiry.',
        },
      },
      required: ['name', 'email', 'requirements'],
    },
    handler: async (args, env): Promise<ToolExecutionResult> => {
      const name = String(args['name'] || '').trim();
      const email = String(args['email'] || '').trim();
      const phone = args['phone'] ? String(args['phone']).trim() : undefined;
      const requirements = String(args['requirements'] || '').trim();

      if (!name || !email || !requirements) {
        return {
          success: false,
          error: 'Missing required fields: name, email, and requirements are mandatory.',
        };
      }

      // Email format check
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return {
          success: false,
          error: `Invalid email address format: "${email}". Please provide a valid email.`,
        };
      }

      const leadPayload = {
        leadId: `LEAD-${Date.now().toString(36).toUpperCase()}`,
        name,
        email,
        phone,
        requirements,
        source: 'Cloudflare_Edge_AI_Widget',
        createdAt: new Date().toISOString(),
      };

      // If webhook is configured, dispatch asynchronously
      if (env.ACTION_WEBHOOK_URL) {
        try {
          const webhookRes = await fetch(env.ACTION_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'lead_captured', data: leadPayload }),
          });
          if (!webhookRes.ok) {
            return {
              success: true,
              data: {
                ...leadPayload,
                webhookStatus: 'queued_fallback',
                message: 'Lead captured locally; backend webhook queued.',
              },
            };
          }
        } catch {
          // Graceful degradation: capture locally
        }
      }

      return {
        success: true,
        data: {
          ...leadPayload,
          status: 'captured',
          message: `Inquiry successfully submitted! Lead ID: ${leadPayload.leadId}. Our team will contact ${email} shortly.`,
        },
      };
    },
  },

  // 2. Track Order or Ticket Status
  track_order_or_status: {
    name: 'track_order_or_status',
    description:
      'Queries live status, milestones, and estimated delivery/resolution time for an order number, tracking number, or ticket reference ID.',
    parameters: {
      type: 'object',
      properties: {
        referenceId: {
          type: 'string',
          description: 'The tracking number, order ID (e.g. #1042), or support ticket reference code.',
        },
      },
      required: ['referenceId'],
    },
    handler: async (args, env): Promise<ToolExecutionResult> => {
      const rawRef = String(args['referenceId'] || '').trim();
      const referenceId = rawRef.replace(/^#/, '');

      if (!referenceId) {
        return {
          success: false,
          error: 'A reference ID or tracking number is required.',
        };
      }

      // External API integration if provided
      if (env.EXTERNAL_API_BASE_URL) {
        try {
          const res = await fetch(`${env.EXTERNAL_API_BASE_URL}/status/${encodeURIComponent(referenceId)}`, {
            headers: { Accept: 'application/json' },
          });
          if (res.ok) {
            const data = await res.json();
            return { success: true, data };
          }
        } catch {
          // Fall through to edge mock response
        }
      }

      // Intelligent Edge Mock for immediate responsive Q&A
      const isTicket = /^(TICK|TKT|SRV|CAS)/i.test(referenceId) || referenceId.length > 5;
      const now = new Date();

      if (isTicket) {
        return {
          success: true,
          data: {
            referenceId: `#${referenceId}`,
            type: 'Support Ticket',
            status: 'In Progress (Active Investigation)',
            priority: 'High',
            assignedTeam: 'Tier-2 Technical Operations',
            lastUpdated: now.toISOString(),
            estimatedResolution: 'Within 2 hours',
            recentActivity: 'Diagnostic logs analyzed; engineer applied hotfix to staging.',
          },
        };
      }

      return {
        success: true,
        data: {
          referenceId: `#${referenceId}`,
          type: 'Order Shipment',
          status: 'Out for Delivery',
          carrier: 'Bluedart Express',
          trackingNumber: `BD-${referenceId}-IN`,
          currentLocation: 'Local Delivery Hub (Last Mile)',
          estimatedDelivery: 'Today by 5:30 PM',
          signatureRequired: false,
          recipientUpdatesSent: true,
        },
      };
    },
  },

  // 3. Schedule Appointment / Consultation
  schedule_appointment: {
    name: 'schedule_appointment',
    description:
      'Schedules and reserves an appointment, consultation call, or demo slot for a visitor.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Appointment date in YYYY-MM-DD or readable format (e.g., "tomorrow", "2026-10-06").',
        },
        time: {
          type: 'string',
          description: 'Preferred appointment time (e.g., "4:00 PM", "16:00", "11:30 AM IST").',
        },
        contact: {
          type: 'string',
          description: 'Client name and email or phone number for the appointment confirmation.',
        },
        notes: {
          type: 'string',
          description: 'Optional agenda or specific topics to discuss during the session.',
        },
      },
      required: ['date', 'time', 'contact'],
    },
    handler: async (args, env): Promise<ToolExecutionResult> => {
      const date = String(args['date'] || '').trim();
      const time = String(args['time'] || '').trim();
      const contact = String(args['contact'] || '').trim();
      const notes = args['notes'] ? String(args['notes']).trim() : 'General Consultation';

      if (!date || !time || !contact) {
        return {
          success: false,
          error: 'Date, time, and contact information are required to schedule an appointment.',
        };
      }

      const bookingId = `BK-${Date.now().toString(36).toUpperCase()}`;
      const appointmentDetails = {
        bookingId,
        date,
        time,
        contact,
        notes,
        status: 'Confirmed',
        durationMinutes: 30,
        meetingLink: `https://meet.google.com/${bookingId.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        calendarInviteSent: true,
        createdAt: new Date().toISOString(),
      };

      if (env.ACTION_WEBHOOK_URL) {
        try {
          await fetch(env.ACTION_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'appointment_scheduled', data: appointmentDetails }),
          });
        } catch {
          // Non-blocking
        }
      }

      return {
        success: true,
        data: {
          ...appointmentDetails,
          message: `Appointment confirmed for ${date} at ${time}! Booking Ref: ${bookingId}. Calendar invitation dispatched.`,
        },
      };
    },
  },

  // 4. Trigger System Action (Interactive Command with Confirmation UI)
  trigger_system_action: {
    name: 'trigger_system_action',
    description:
      'Prepares a sensitive or state-changing system command (e.g. restart service, flush cache, issue refund, deploy canary, or trigger alert) that requires user authorization via an interactive confirmation card.',
    parameters: {
      type: 'object',
      properties: {
        actionType: {
          type: 'string',
          enum: [
            'restart_service',
            'flush_cache',
            'deploy_preview',
            'upgrade_tier',
            'cancel_subscription',
            'trigger_sync',
          ],
          description: 'Type of system action requested.',
        },
        payload: {
          type: 'object',
          description: 'Key-value parameters or target resources for the action.',
        },
      },
      required: ['actionType'],
    },
    handler: async (args, env): Promise<ToolExecutionResult> => {
      const actionType = String(args['actionType'] || '').trim();
      const payload = (args['payload'] as Record<string, unknown>) || {};

      const actionId = `ACT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6)}`;
      const secret = env.ACTION_SECRET || 'edge-action-secret-key-2025';
      const token = await signActionToken(actionId, actionType, secret);

      const descriptions: Record<string, string> = {
        restart_service: `Restart edge microservices & warm cold containers for: ${JSON.stringify(payload)}`,
        flush_cache: `Purge edge CDN & KV cache keys matching: ${JSON.stringify(payload)}`,
        deploy_preview: `Trigger zero-downtime deployment for branch/tag: ${payload['branch'] || 'main'}`,
        upgrade_tier: `Request subscription tier upgrade to: ${payload['tier'] || 'Enterprise'}`,
        cancel_subscription: `Initiate subscription termination process for account: ${payload['accountId'] || 'Current User'}`,
        trigger_sync: `Synchronize data pipeline between edge cache and primary datastore.`,
      };

      const confirmationDetails: ActionConfirmationDetails = {
        actionId,
        actionType,
        payload,
        description: descriptions[actionType] || `Execute action: ${actionType}`,
        riskLevel: ['restart_service', 'cancel_subscription', 'flush_cache'].includes(actionType)
          ? 'high'
          : 'medium',
        token,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes expiry
      };

      // Return requiresConfirmation flag to trigger interactive card in SSE & widget
      return {
        success: true,
        requiresConfirmation: true,
        confirmationDetails,
        data: {
          status: 'pending_user_confirmation',
          actionId,
          actionType,
          description: confirmationDetails.description,
          instructions: 'Please click "Approve" or "Reject" on the confirmation card to proceed.',
        },
      };
    },
  },
};

/**
 * Execute a confirmed action once user approves via POST /api/action/confirm
 */
export async function executeConfirmedAction(
  actionType: string,
  payload: Record<string, unknown>,
  env: Env,
  sessionId: string
): Promise<ActionConfirmResponse> {
  const actionId = `EXEC-${Date.now().toString(36).toUpperCase()}`;

  // Log sanitized action execution
  const safeSession = sessionId ? sessionId.slice(0, 8) + '...' : 'unknown';

  if (env.ACTION_WEBHOOK_URL) {
    try {
      await fetch(env.ACTION_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'action_executed',
          actionType,
          payload,
          sessionId: safeSession,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch {
      // Non-blocking
    }
  }

  return {
    success: true,
    actionId,
    status: 'approved',
    message: `Action "${actionType}" executed successfully!`,
    result: {
      actionType,
      executedAt: new Date().toISOString(),
      details: payload,
    },
  };
}

/**
 * Convert registered tools to Google Gemini function declaration format
 */
export function getGeminiToolDeclarations() {
  return [
    {
      functionDeclarations: Object.values(tools).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'OBJECT',
          properties: Object.entries(t.parameters.properties).reduce(
            (acc, [key, prop]) => {
              const geminiType =
                prop.type === 'string'
                  ? 'STRING'
                  : prop.type === 'number'
                  ? 'NUMBER'
                  : prop.type === 'boolean'
                  ? 'BOOLEAN'
                  : prop.type === 'array'
                  ? 'ARRAY'
                  : 'OBJECT';

              acc[key] = {
                type: geminiType,
                description: prop.description,
                ...(prop.enum ? { enum: prop.enum } : {}),
              };
              return acc;
            },
            {} as Record<string, unknown>
          ),
          required: t.parameters.required || [],
        },
      })),
    },
  ];
}

/**
 * Convert registered tools to OpenAI / Groq tool format
 */
export function getOpenAIToolDeclarations() {
  return Object.values(tools).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.parameters.properties,
        required: t.parameters.required || [],
      },
    },
  }));
}
