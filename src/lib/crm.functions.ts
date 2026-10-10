import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function check(pw: string) {
  const real = process.env["DASHBOARD_PASSWORD"];
  if (!real || pw !== real) throw new Error("كلمة المرور غير صحيحة");
}

export const listCustomers = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pw: z.string() }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("customers").select("*").order("last_at", { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    const since = new Date(Date.now() - 2 * 864e5).toISOString();
    const { data: cm } = await supabaseAdmin.from("messages").select("customer_id, created_at")
      .eq("direction", "customer").gte("created_at", since).order("created_at", { ascending: false }).limit(3000);
    const lastIn: Record<string, string> = {};
    for (const m of cm ?? []) if (!lastIn[m.customer_id]) lastIn[m.customer_id] = m.created_at;
    return rows.map((r) => ({ ...r, notes: ((r as Record<string, unknown>)["notes"] as string | null) ?? null, last_customer_at: lastIn[r.id] ?? null }));
  });

export const setBotPaused = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pw: z.string(), id: z.string().uuid(), paused: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("customers").update({ bot_paused: data.paused } as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveNote = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pw: z.string(), id: z.string().uuid(), notes: z.string().max(5000) }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("customers").update({ notes: data.notes } as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMessages = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pw: z.string(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("customers").update({ unread: 0 }).eq("id", data.id);
    const { data: rows, error } = await supabaseAdmin
      .from("messages").select("*").eq("customer_id", data.id)
      .order("created_at", { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    return rows;
  });

export const sendMessage = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pw: z.string(), id: z.string().uuid(), text: z.string().trim().min(1).max(4000) }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c, error } = await supabaseAdmin.from("customers").select("phone").eq("id", data.id).single();
    if (error || !c) throw new Error("العميل غير موجود");
    const res = await fetch("https://n8n.srv1994780.hstgr.cloud/webhook/actes-send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-secret": process.env["BOT_INGEST_SECRET"] ?? "" },
      body: JSON.stringify({ phone: c.phone, text: data.text }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`n8n send failed [${res.status}]: ${body}`);
      throw new Error(`تعذّر الإرسال (${res.status})`);
    }
    const now = new Date().toISOString();
    await supabaseAdmin.from("messages").insert({ customer_id: data.id, direction: "agent", kind: "text", text: data.text });
    await supabaseAdmin.from("customers").update({ last_message: data.text, last_at: now }).eq("id", data.id);
    return { ok: true };
  });

const CONFIRM_TEXT = "أكتس لاستيراد أنظمة الطاقة\nشكراً لك، لقد تم تأكيد فاتورتك.\nستتواصل معك إدارة المبيعات في شركة أكتس خلال لحظات.";
const CANCEL_TEXT = "أكتس لاستيراد أنظمة الطاقة\nلم يتم العثور على إشعار التحويل حتى الآن.\nيرجى التأكد من التحويل أو إعادة إرسال الإشعار.";

export const listOrders = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pw: z.string() }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("orders").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return rows;
  });

export const decideOrder = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pw: z.string(), id: z.string().uuid(), status: z.enum(["confirmed", "cancelled"]) }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: o, error } = await supabaseAdmin.from("orders").select("*").eq("id", data.id).single();
    if (error || !o) throw new Error("الطلب غير موجود");
    if (o.status !== "pending") throw new Error("تم البت في هذا الطلب مسبقاً");
    const text = data.status === "confirmed" ? CONFIRM_TEXT : CANCEL_TEXT;
    const res = await fetch("https://n8n.srv1994780.hstgr.cloud/webhook/actes-send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-secret": process.env["BOT_INGEST_SECRET"] ?? "" },
      body: JSON.stringify({ phone: o.phone, text }),
    });
    if (!res.ok) {
      console.error(`n8n send failed [${res.status}]: ${await res.text()}`);
      throw new Error(`تعذّر إرسال الإشعار للعميل (${res.status})`);
    }
    const now = new Date().toISOString();
    await supabaseAdmin.from("orders").update({ status: data.status, decided_at: now }).eq("id", data.id);
    if (o.customer_id) {
      await supabaseAdmin.from("messages").insert({ customer_id: o.customer_id, direction: "agent", kind: "text", text });
      await supabaseAdmin.from("customers").update({ last_message: text, last_at: now }).eq("id", o.customer_id);
    }
    return { ok: true };
  });

export const listTickets = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pw: z.string() }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("support_tickets").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return rows;
  });

const TICKET_TEXT: Record<string, string> = {
  in_progress: "أكتس لاستيراد أنظمة الطاقة\nتذكرة الدعم {no}: استلم مهندس الصيانة بلاغك وجاري المتابعة.",
  resolved: "أكتس لاستيراد أنظمة الطاقة\nتذكرة الدعم {no}: تم حل المشكلة وإغلاق التذكرة. شكراً لثقتك.",
};

export const updateTicket = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({
    pw: z.string(), id: z.string().uuid(),
    status: z.enum(["open", "in_progress", "resolved"]),
    assigned_to: z.string().max(120).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: t, error } = await supabaseAdmin.from("support_tickets").select("*").eq("id", data.id).single();
    if (error || !t) throw new Error("التذكرة غير موجودة");
    const tpl = TICKET_TEXT[data.status];
    if (tpl && t.status !== data.status) {
      const text = tpl.replace("{no}", t.ticket_no);
      const res = await fetch("https://n8n.srv1994780.hstgr.cloud/webhook/actes-send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bot-secret": process.env["BOT_INGEST_SECRET"] ?? "" },
        body: JSON.stringify({ phone: t.phone, text }),
      });
      if (!res.ok) {
        console.error(`n8n send failed [${res.status}]: ${await res.text()}`);
        throw new Error(`تعذّر إرسال الإشعار للعميل (${res.status})`);
      }
      if (t.customer_id) {
        await supabaseAdmin.from("messages").insert({ customer_id: t.customer_id, direction: "agent", kind: "text", text });
      }
    }
    await supabaseAdmin.from("support_tickets").update({
      status: data.status,
      assigned_to: data.assigned_to ?? t.assigned_to,
      resolved_at: data.status === "resolved" ? new Date().toISOString() : null,
    }).eq("id", data.id);
    return { ok: true };
  });

// Stage 3: draft a technical inquiry for the manufacturer (staff only, never sent to the customer).
export const draftVendorQuery = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pw: z.string(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: t } = await supabaseAdmin.from("support_tickets").select("*").eq("id", data.id).single();
    if (!t) throw new Error("التذكرة غير موجودة");
    const { askAI } = await import("@/lib/ai.server");
    const text = await askAI({
      instructions: "You are a solar service engineer at ACTES (Yemen distributor). Write a concise, professional technical support inquiry email in English to the manufacturer's after-sales team about this field case. Include: subject line, product/model, fault code or symptom, steps already tried, and specific questions. Do not include customer name or phone. Plain text, under 1200 characters.",
      input: `Ticket ${t.ticket_no}\nDevice: ${t.device ?? ""}\nIssue type: ${t.issue_type ?? ""}\nDescription (Arabic): ${t.description ?? ""}`,
    });
    return { text };
  });

// Stage 3: send the final solution to the customer in ACTES' name.
export const replyTicket = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pw: z.string(), id: z.string().uuid(), text: z.string().min(2).max(3000) }).parse(d))
  .handler(async ({ data }) => {
    check(data.pw);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: t } = await supabaseAdmin.from("support_tickets").select("*").eq("id", data.id).single();
    if (!t) throw new Error("التذكرة غير موجودة");
    const text = `أكتس لاستيراد أنظمة الطاقة\nبخصوص تذكرة الدعم ${t.ticket_no}:\n\n${data.text}`;
    const res = await fetch("https://n8n.srv1994780.hstgr.cloud/webhook/actes-send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-secret": process.env["BOT_INGEST_SECRET"] ?? "" },
      body: JSON.stringify({ phone: t.phone, text }),
    });
    if (!res.ok) throw new Error(`تعذّر الإرسال للعميل (${res.status})`);
    if (t.customer_id) {
      await supabaseAdmin.from("messages").insert({ customer_id: t.customer_id, direction: "agent", kind: "text", text });
    }
    if (t.status === "open") await supabaseAdmin.from("support_tickets").update({ status: "in_progress" }).eq("id", data.id);
    return { ok: true };
  });
