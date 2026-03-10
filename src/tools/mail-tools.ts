import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { getPlayerByName, updatePlayerGold } from '../models/player.js';
import { enforceCooldown } from '../server/cooldown.js';
import { validateContent, sanitizeHtml } from '../utils/content-filter.js';
import {
  sendMail,
  getInbox,
  getMailById,
  markRead,
  deleteMail,
  getUnreadCount,
  getInboxCount,
  claimMailGold,
} from '../models/mail.js';
import {
  MAIL_COOLDOWN_MS,
  MAX_MAIL_SUBJECT_LENGTH,
  MAX_MAIL_BODY_LENGTH,
} from '../types/index.js';
import { getDb } from '../db/connection.js';
import { checkMuted } from './admin-tools.js';
import { routeMailRevenue, MAIL_DELIVERY_FEE } from '../game/company-revenue.js';

/** Strip control characters that break JSON parsing on the client side. */
const sanitizedSubject = z.string().min(1).max(MAX_MAIL_SUBJECT_LENGTH)
  .transform(s => s.replace(/[\x00-\x1f]/g, ''));

const sanitizedBody = z.string().min(1).max(MAX_MAIL_BODY_LENGTH)
  .transform(s => s.replace(/[\x00-\x1f]/g, ''));

export function registerMailTools(server: McpServer): void {
  // ---------- send_mail ----------

  server.tool(
    'send_mail',
    'Send a mail to any player, anywhere in the world. Optionally attach gold.',
    {
      token: z.string().uuid().describe('Your auth token'),
      to: z.string().min(1).describe('Recipient player name'),
      subject: sanitizedSubject.describe('Subject line (max 100 chars)'),
      body: sanitizedBody.describe('Message body (max 2000 chars)'),
      gold_attached: z.number().int().min(0).default(0)
        .describe('Gold to attach (deducted from your balance)'),
    },
    async ({ token, to, subject, body, gold_attached }) => {
      try {
        const player = authenticate(token);
        checkMuted(player.id);

        const cd = enforceCooldown(player.id, 'mail', MAIL_COOLDOWN_MS);
        if (cd !== null) {
          return { content: [{ type: 'text' as const, text: `Please wait ${cd}s before sending another mail.` }] };
        }

        const sanitizedSubject = sanitizeHtml(subject);
        const sanitizedBody = sanitizeHtml(body);
        validateContent(sanitizedSubject, 'subject');
        validateContent(sanitizedBody, 'body');

        const target = getPlayerByName(to);
        if (!target) {
          return { content: [{ type: 'text' as const, text: `Player "${to}" not found.` }] };
        }
        if (target.id === player.id) {
          return { content: [{ type: 'text' as const, text: 'You cannot mail yourself.' }] };
        }

        // Check if target has blocked the sender
        const db = getDb();
        const blocked = db.prepare(
          'SELECT 1 FROM player_blocks WHERE blocker_id = ? AND blocked_id = ?',
        ).get(target.id, player.id);
        if (blocked) {
          return { content: [{ type: 'text' as const, text: `${target.name} has blocked you.` }] };
        }

        const totalCost = MAIL_DELIVERY_FEE + gold_attached;
        if (player.gold < totalCost) {
          return { content: [{ type: 'text' as const, text: `Insufficient gold. Mail costs ${MAIL_DELIVERY_FEE}g delivery fee${gold_attached > 0 ? ` + ${gold_attached}g attachment` : ''}. You have ${player.gold}g.` }] };
        }

        // Deduct delivery fee + attachment in one update
        updatePlayerGold(player.id, player.gold - totalCost);
        // Delivery fee → Imperial Mail Co. revenue
        routeMailRevenue(MAIL_DELIVERY_FEE);

        const mail = sendMail(player.id, target.id, sanitizedSubject, sanitizedBody, gold_attached);

        const goldNote = gold_attached > 0 ? ` with ${gold_attached}g attached` : '';
        return {
          content: [{ type: 'text' as const, text: `Mail sent to ${target.name} (fee: ${MAIL_DELIVERY_FEE}g)${goldNote}! (ID: ${mail.id})` }],
        };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text' as const, text: message }] };
      }
    }
  );

  // ---------- check_mail ----------

  server.tool(
    'check_mail',
    'Check your mail inbox. Shows last 50 messages with pagination (20 per page).',
    {
      token: z.string().uuid().describe('Your auth token'),
      page: z.number().int().min(1).default(1).describe('Page number (20 mails per page)'),
    },
    async ({ token, page }) => {
      try {
        const player = authenticate(token);
        const messages = getInbox(player.id, page);
        const unreadCount = getUnreadCount(player.id);
        const totalCount = getInboxCount(player.id);
        const totalPages = Math.max(1, Math.ceil(totalCount / 20));

        if (messages.length === 0) {
          if (page > 1) {
            return { content: [{ type: 'text' as const, text: `No mail on page ${page}. You have ${totalCount} messages (${totalPages} pages).` }] };
          }
          return { content: [{ type: 'text' as const, text: 'Your inbox is empty.' }] };
        }

        const header = `Inbox (${unreadCount} unread, ${totalCount} total) - Page ${page}/${totalPages}:`;
        const lines = messages.map(m => {
          const readMark = m.is_read ? '  ' : '* ';
          const subj = m.subject || '(no subject)';
          const goldTag = m.gold_attached > 0 ? ` [${m.gold_attached}g]` : '';
          return `${readMark}#${m.id} from ${m.sender_name}: "${subj}"${goldTag} (${m.created_at})`;
        });

        return { content: [{ type: 'text' as const, text: `${header}\n${lines.join('\n')}` }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text' as const, text: message }] };
      }
    }
  );

  // ---------- read_mail ----------

  server.tool(
    'read_mail',
    'Read a specific mail message. If gold is attached, it is transferred to you on first read.',
    {
      token: z.string().uuid().describe('Your auth token'),
      mail_id: z.number().int().positive().describe('Mail ID to read'),
    },
    async ({ token, mail_id }) => {
      try {
        const player = authenticate(token);
        const mail = getMailById(mail_id, player.id);
        if (!mail) {
          return { content: [{ type: 'text' as const, text: 'Mail not found or not addressed to you.' }] };
        }

        const wasUnread = !mail.is_read;
        let goldNote = '';

        if (wasUnread) {
          markRead(mail_id);
          if (mail.gold_attached > 0) {
            claimMailGold(mail_id, player.id, mail.gold_attached);
            goldNote = `\n\nYou received ${mail.gold_attached}g from this mail!`;
          }
        }

        const subj = mail.subject || '(no subject)';
        const goldLine = mail.gold_attached > 0 ? `\nGold attached: ${mail.gold_attached}g` : '';
        const text = [
          `From: ${mail.sender_name}`,
          `Subject: ${subj}`,
          `Date: ${mail.created_at}`,
          goldLine ? goldLine : '',
          `---`,
          mail.body,
          goldNote,
        ].filter(Boolean).join('\n');

        return { content: [{ type: 'text' as const, text }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text' as const, text: message }] };
      }
    }
  );

  // ---------- delete_mail ----------

  server.tool(
    'delete_mail',
    'Delete a mail from your inbox.',
    {
      token: z.string().uuid().describe('Your auth token'),
      mail_id: z.number().int().positive().describe('Mail ID to delete'),
    },
    async ({ token, mail_id }) => {
      try {
        const player = authenticate(token);
        const deleted = deleteMail(mail_id, player.id);
        if (!deleted) {
          return { content: [{ type: 'text' as const, text: 'Mail not found or not addressed to you.' }] };
        }

        return { content: [{ type: 'text' as const, text: `Mail #${mail_id} deleted.` }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text' as const, text: message }] };
      }
    }
  );
}
