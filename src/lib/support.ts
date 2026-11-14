import { query } from "@/lib/db";

export type TicketStatus = "open" | "closed";

export type SupportTicket = {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  orderId: string | null;
  orderNo: string | null;
  subject: string;
  status: TicketStatus;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  messageCount: number;
};

export type SupportTicketMessage = {
  id: string;
  author: "customer" | "admin";
  body: string;
  createdAt: string;
};

type TicketRow = {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  order_id: string | null;
  order_no: string | null;
  subject: string;
  status: string;
  unread_count: string | number;
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_at: string | null;
  message_count: string | number;
};

function mapTicket(row: TicketRow): SupportTicket {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    orderId: row.order_id,
    orderNo: row.order_no,
    subject: row.subject,
    status: row.status as TicketStatus,
    unreadCount: Number(row.unread_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    messageCount: Number(row.message_count || 0),
  };
}

// Unread = messages written by the other party after this side last read the
// ticket. `customer_read_at`/`admin_read_at` are the per-ticket read markers.
const UNREAD_FOR_CUSTOMER = `(SELECT COUNT(*) FROM support_ticket_messages m
  WHERE m.ticket_id = t.id AND m.author = 'admin'
    AND (t.customer_read_at IS NULL OR m.created_at > t.customer_read_at))::int`;

const UNREAD_FOR_ADMIN = `(SELECT COUNT(*) FROM support_ticket_messages m
  WHERE m.ticket_id = t.id AND m.author = 'customer'
    AND (t.admin_read_at IS NULL OR m.created_at > t.admin_read_at))::int`;

function ticketSelect(unreadExpr: string): string {
  return `
  SELECT t.id, t.user_id, u.email AS user_email, u.name AS user_name,
         t.order_id, o.order_no, t.subject, t.status,
         ${unreadExpr} AS unread_count,
         t.created_at, t.updated_at,
         (SELECT m.body FROM support_ticket_messages m
           WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
         (SELECT m.created_at FROM support_ticket_messages m
           WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
         (SELECT COUNT(*) FROM support_ticket_messages m
           WHERE m.ticket_id = t.id)::int AS message_count
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN shop_orders o ON o.id = t.order_id
`;
}

export async function listUserTickets(userId: string): Promise<SupportTicket[]> {
  const result = await query<TicketRow>(
    `${ticketSelect(UNREAD_FOR_CUSTOMER)} WHERE t.user_id = $1 ORDER BY t.updated_at DESC LIMIT 100`,
    [userId],
  );
  return result.rows.map(mapTicket);
}

export async function listAllTickets(): Promise<SupportTicket[]> {
  const result = await query<TicketRow>(
    `${ticketSelect(UNREAD_FOR_ADMIN)} ORDER BY (t.status = 'open') DESC, t.updated_at DESC LIMIT 200`,
  );
  return result.rows.map(mapTicket);
}

export async function listTicketMessages(
  ticketId: string,
): Promise<SupportTicketMessage[]> {
  const result = await query<{
    id: string;
    author: string;
    body: string;
    created_at: string;
  }>(
    `SELECT id, author, body, created_at
       FROM support_ticket_messages
      WHERE ticket_id = $1
      ORDER BY created_at ASC`,
    [ticketId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    author: row.author as "customer" | "admin",
    body: row.body,
    createdAt: row.created_at,
  }));
}

export async function getTicketForUser(
  ticketId: string,
  userId: string,
): Promise<SupportTicket | null> {
  const result = await query<TicketRow>(
    `${ticketSelect(UNREAD_FOR_CUSTOMER)} WHERE t.id = $1 AND t.user_id = $2 LIMIT 1`,
    [ticketId, userId],
  );
  return result.rows[0] ? mapTicket(result.rows[0]) : null;
}

export async function getTicket(ticketId: string): Promise<SupportTicket | null> {
  const result = await query<TicketRow>(
    `${ticketSelect(UNREAD_FOR_ADMIN)} WHERE t.id = $1 LIMIT 1`,
    [ticketId],
  );
  return result.rows[0] ? mapTicket(result.rows[0]) : null;
}

export async function createTicket(input: {
  userId: string;
  subject: string;
  message: string;
  orderId?: string | null;
}): Promise<string> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO support_tickets (user_id, order_id, subject)
     VALUES ($1, $2, $3) RETURNING id`,
    [input.userId, input.orderId || null, input.subject],
  );
  const ticketId = inserted.rows[0].id;
  await query(
    `INSERT INTO support_ticket_messages (ticket_id, author, body)
     VALUES ($1, 'customer', $2)`,
    [ticketId, input.message],
  );
  return ticketId;
}

export async function addCustomerReply(input: {
  ticketId: string;
  userId: string;
  message: string;
}): Promise<void> {
  await query(
    `INSERT INTO support_ticket_messages (ticket_id, author, body)
     VALUES ($1, 'customer', $2)`,
    [input.ticketId, input.message],
  );
  // A customer reply reopens a closed ticket.
  await query(
    `UPDATE support_tickets SET status = 'open', updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [input.ticketId, input.userId],
  );
}

export async function addAdminReply(input: {
  ticketId: string;
  message: string;
}): Promise<void> {
  await query(
    `INSERT INTO support_ticket_messages (ticket_id, author, body)
     VALUES ($1, 'admin', $2)`,
    [input.ticketId, input.message],
  );
  await query(
    `UPDATE support_tickets SET updated_at = now() WHERE id = $1`,
    [input.ticketId],
  );
}

export async function setTicketStatus(
  ticketId: string,
  status: TicketStatus,
): Promise<void> {
  await query(
    `UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1`,
    [ticketId, status],
  );
}

export async function countOpenTickets(): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM support_tickets WHERE status = 'open'`,
  );
  return Number(result.rows[0]?.count || 0);
}

export async function markTicketReadByCustomer(
  ticketId: string,
  userId: string,
): Promise<void> {
  await query(
    `UPDATE support_tickets SET customer_read_at = now()
      WHERE id = $1 AND user_id = $2`,
    [ticketId, userId],
  );
}

export async function markTicketReadByAdmin(ticketId: string): Promise<void> {
  await query(
    `UPDATE support_tickets SET admin_read_at = now() WHERE id = $1`,
    [ticketId],
  );
}

export async function countUnreadMessagesForUser(userId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM support_ticket_messages m
       JOIN support_tickets t ON t.id = m.ticket_id
      WHERE t.user_id = $1
        AND m.author = 'admin'
        AND (t.customer_read_at IS NULL OR m.created_at > t.customer_read_at)`,
    [userId],
  );
  return Number(result.rows[0]?.count || 0);
}

export async function countUnreadMessagesForAdmin(): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM support_ticket_messages m
       JOIN support_tickets t ON t.id = m.ticket_id
      WHERE m.author = 'customer'
        AND (t.admin_read_at IS NULL OR m.created_at > t.admin_read_at)`,
  );
  return Number(result.rows[0]?.count || 0);
}
